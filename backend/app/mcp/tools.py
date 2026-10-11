import uuid
from collections.abc import Coroutine
from datetime import date, time
from typing import Any

from fastapi import HTTPException
from mcp.server.mcpserver.exceptions import ToolError
from pydantic import BaseModel, ValidationError
from sqlalchemy import func, select

from app.core.db import async_session_factory
from app.mcp.auth import current_user_id
from app.mcp.instance import server
from app.models.folder import Folder
from app.models.note import Note
from app.models.tag import NoteTag, Tag
from app.models.task import Task
from app.models.task_list import TaskList, TaskListColor, TaskListIcon
from app.models.user import User
from app.schemas.folder import FolderCreate, FolderUpdate
from app.schemas.note import NoteCreate, NoteUpdate
from app.schemas.task import TaskCreate, TaskUpdate
from app.schemas.task_list import TaskListCreate, TaskListUpdate
from app.services import folders as folders_service
from app.services import note_links as note_links_service
from app.services import notes as notes_service
from app.services import search as search_service
from app.services import task_lists as task_lists_service
from app.services import tasks as tasks_service


def _uuid(value: str, field: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError as exc:
        raise ToolError(f"'{value}' is not a valid {field} id") from exc


def _date(value: str | None) -> date | None:
    try:
        return date.fromisoformat(value) if value else None
    except ValueError as exc:
        raise ToolError(f"'{value}' is not a date (expected YYYY-MM-DD)") from exc


def _time(value: str | None) -> time | None:
    try:
        return time.fromisoformat(value) if value else None
    except ValueError as exc:
        raise ToolError(f"'{value}' is not a time (expected HH:MM)") from exc


async def _run[T](coro: Coroutine[Any, Any, T]) -> T:
    """Runs a service call, turning its `HTTPException` (the isolation helper's 404,
    a version conflict, ...) into a `ToolError` the model sees as a clean error message
    instead of a generic "Error executing tool" crash — see exceptions.py's own
    docstrings for why only `ToolError` gets to keep its message."""
    try:
        return await coro
    except HTTPException as exc:
        raise ToolError(str(exc.detail)) from exc


def _validated[M: BaseModel](model: type[M], **values: Any) -> M:
    """Builds a request schema, reporting invalid input to the model as a clean
    `ToolError` instead of an opaque crash."""
    try:
        return model(**values)
    except ValidationError as exc:
        problems = "; ".join(
            f"{'.'.join(str(p) for p in err['loc'])}: {err['msg']}" for err in exc.errors()
        )
        raise ToolError(f"Invalid input — {problems}") from exc


def _note_summary(note: Note) -> dict[str, Any]:
    return {
        "id": str(note.id),
        "title": note.title,
        "folder_id": str(note.folder_id) if note.folder_id else None,
        "updated_at": note.updated_at.isoformat(),
    }


def _task_summary(twc: tasks_service.TaskWithCounts) -> dict[str, Any]:
    task = twc.task
    return {
        "id": str(task.id),
        "list_id": str(task.list_id),
        "title": task.title,
        "status": task.status.value,
        "priority": task.priority.value,
        "due_date": task.due_date.isoformat() if task.due_date else None,
        "due_time": task.due_time.isoformat() if task.due_time else None,
        "subtasks_done": twc.counts.done,
        "subtasks_total": twc.counts.total,
    }


def _task_detail(task: Task) -> dict[str, Any]:
    return {
        "id": str(task.id),
        "list_id": str(task.list_id),
        "parent_id": str(task.parent_id) if task.parent_id else None,
        "title": task.title,
        "description": task.description,
        "status": task.status.value,
        "priority": task.priority.value,
        "due_date": task.due_date.isoformat() if task.due_date else None,
        "due_time": task.due_time.isoformat() if task.due_time else None,
    }


# --- Notes ------------------------------------------------------------------


@server.tool()
async def list_notes(folder_id: str | None = None, tag: str | None = None) -> list[dict[str, Any]]:
    """List the user's notes, optionally scoped to a folder or to a tag (`tag="books"`,
    without the `#`; see `list_tags`). Omit both for every non-trashed note. Use
    `folder_id`/note ids from `list_folders`/`search_notes`."""
    user_id = current_user_id()
    async with async_session_factory() as session:
        notes = await _run(
            notes_service.list_notes(
                session,
                user_id,
                folder_id=_uuid(folder_id, "folder") if folder_id else None,
                folder_filter=folder_id is not None,
                tag=tag,
            )
        )
        return [_note_summary(n) for n in notes]


@server.tool()
async def search_notes(query: str) -> list[dict[str, Any]]:
    """Full-text search over the user's notes (English and Russian). Supports the same
    filters the app's search box does: `tag:name`, `path:folder`, plus free text."""
    user_id = current_user_id()
    async with async_session_factory() as session:
        filters = search_service.parse_query(query)
        results = await _run(search_service.search_notes(session, user_id, filters))
        return [
            {
                "id": str(r.id),
                "title": r.title,
                "folder_id": str(r.folder_id) if r.folder_id else None,
                "snippet": r.snippet,
            }
            for r in results
        ]


@server.tool()
async def get_note(note_id: str) -> dict[str, Any]:
    """Get a note's full Markdown content, tags and metadata by id."""
    user_id = current_user_id()
    nid = _uuid(note_id, "note")
    async with async_session_factory() as session:
        note = await _run(notes_service.get_note(session, user_id, nid))
        tags = await notes_service.get_note_tags(session, nid)
        return {**_note_summary(note), "content": note.content, "tags": tags}


@server.tool()
async def create_note(
    title: str, content: str = "", folder_id: str | None = None
) -> dict[str, Any]:
    """Create a note. `content` is Markdown — use `[[Other Note Title]]` to link another
    note and `#tag` for tags, same as the editor. Leave `folder_id` unset for the root."""
    user_id = current_user_id()
    # Same validation as the REST endpoint (title/content length, NUL characters).
    data = _validated(
        NoteCreate,
        title=title,
        content=content,
        folder_id=_uuid(folder_id, "folder") if folder_id else None,
    )
    async with async_session_factory() as session:
        note = await _run(
            notes_service.create_note(session, user_id, data.title, data.folder_id, data.content)
        )
        return _note_summary(note)


@server.tool()
async def update_note(
    note_id: str,
    title: str | None = None,
    content: str | None = None,
    update_links: bool = True,
) -> dict[str, Any]:
    """Update a note's title and/or content. Only the fields you pass are changed. When
    renaming, `[[Old title]]` links in other notes are rewritten to the new title unless
    `update_links` is false. To move a note to another folder, use `move_note`."""
    user_id = current_user_id()
    nid = _uuid(note_id, "note")
    async with async_session_factory() as session:
        current = await _run(notes_service.get_note(session, user_id, nid))
        note = await _run(
            notes_service.update_note(
                session,
                user_id,
                nid,
                _validated(
                    NoteUpdate,
                    version=current.version,
                    title=title,
                    content=content,
                    update_links=update_links and title is not None,
                ),
            )
        )
        return _note_summary(note)


@server.tool()
async def move_note(note_id: str, folder_id: str | None = None) -> dict[str, Any]:
    """Move a note into a folder (`folder_id` from `list_folders`), or to the top level
    when `folder_id` is omitted. Links to it keep working."""
    user_id = current_user_id()
    nid = _uuid(note_id, "note")
    async with async_session_factory() as session:
        current = await _run(notes_service.get_note(session, user_id, nid))
        note = await _run(
            notes_service.update_note(
                session,
                user_id,
                nid,
                _validated(
                    NoteUpdate,
                    version=current.version,
                    folder_id=_uuid(folder_id, "folder") if folder_id else None,
                    move_to_root=folder_id is None,
                ),
            )
        )
        return _note_summary(note)


@server.tool()
async def get_backlinks(note_id: str) -> list[dict[str, Any]]:
    """The notes that link to this one with `[[...]]` (id, title, folder, and the
    `#heading` the link points at, if any)."""
    user_id = current_user_id()
    nid = _uuid(note_id, "note")
    async with async_session_factory() as session:
        await _run(notes_service.get_note(session, user_id, nid))  # not found / not yours
        links = await note_links_service.get_backlinks(session, user_id, nid)
        return [{**_note_summary(source), "heading": link.heading} for link, source in links]


@server.tool()
async def list_tags() -> list[dict[str, Any]]:
    """The user's tags with how many notes carry each. Pass a name to
    `list_notes(tag=...)`, or use `tag:name` in `search_notes`."""
    user_id = current_user_id()
    async with async_session_factory() as session:
        result = await session.execute(
            select(Tag.name, func.count(NoteTag.note_id))
            .join(NoteTag, NoteTag.tag_id == Tag.id)
            .join(Note, Note.id == NoteTag.note_id)
            .where(Tag.user_id == user_id, Note.deleted_at.is_(None))
            .group_by(Tag.name)
            .order_by(Tag.name)
        )
        return [{"name": name, "note_count": count} for name, count in result.all()]


@server.tool()
async def delete_note(note_id: str) -> dict[str, str]:
    """Move a note to trash (spec: auto-purged after 30 days). Not permanent."""
    user_id = current_user_id()
    async with async_session_factory() as session:
        await _run(notes_service.soft_delete_note(session, user_id, _uuid(note_id, "note")))
        return {"status": "trashed"}


@server.tool()
async def list_folders() -> list[dict[str, Any]]:
    """List the user's note folders (id, name, parent), for passing as `folder_id`."""
    user_id = current_user_id()
    async with async_session_factory() as session:
        folders = await _run(folders_service.list_folders(session, user_id))
        return [_folder(f) for f in folders]


def _folder(folder: Folder) -> dict[str, Any]:
    return {
        "id": str(folder.id),
        "name": folder.name,
        "parent_id": str(folder.parent_id) if folder.parent_id else None,
    }


@server.tool()
async def create_folder(name: str, parent_id: str | None = None) -> dict[str, Any]:
    """Create a note folder, at the top level or inside `parent_id` (from
    `list_folders`)."""
    user_id = current_user_id()
    data = _validated(
        FolderCreate, name=name, parent_id=_uuid(parent_id, "folder") if parent_id else None
    )
    async with async_session_factory() as session:
        folder = await _run(
            folders_service.create_folder(session, user_id, data.name, data.parent_id)
        )
        return _folder(folder)


@server.tool()
async def rename_folder(folder_id: str, name: str) -> dict[str, Any]:
    """Rename a folder."""
    user_id = current_user_id()
    async with async_session_factory() as session:
        folder = await _run(
            folders_service.update_folder(
                session, user_id, _uuid(folder_id, "folder"), _validated(FolderUpdate, name=name)
            )
        )
        return _folder(folder)


@server.tool()
async def move_folder(folder_id: str, parent_id: str | None = None) -> dict[str, Any]:
    """Move a folder, with everything in it, inside another folder, or to the top level
    when `parent_id` is omitted. A folder can't go inside itself or its own subfolders."""
    user_id = current_user_id()
    async with async_session_factory() as session:
        folder = await _run(
            folders_service.update_folder(
                session,
                user_id,
                _uuid(folder_id, "folder"),
                _validated(
                    FolderUpdate,
                    parent_id=_uuid(parent_id, "folder") if parent_id else None,
                    move_to_root=parent_id is None,
                ),
            )
        )
        return _folder(folder)


@server.tool()
async def delete_folder(folder_id: str) -> dict[str, str]:
    """Move a folder to trash together with its subfolders and every note in them (the
    notes can be restored from Trash in the app for 30 days). To keep the notes, move
    them out first with `move_note`."""
    user_id = current_user_id()
    async with async_session_factory() as session:
        await _run(folders_service.delete_folder(session, user_id, _uuid(folder_id, "folder")))
        return {"status": "trashed"}


# --- Tasks --------------------------------------------------------------------


@server.tool()
async def list_tasks(
    view: str | None = None, list_id: str | None = None, status: str = "open"
) -> list[dict[str, Any]]:
    """List the user's top-level tasks. `view`: "today" (overdue + due today), "upcoming"
    (due today or later), or omit for all matching `status` ("open", "done", "all")."""
    user_id = current_user_id()
    async with async_session_factory() as session:
        user = await session.get(User, user_id)
        timezone = user.timezone if user else "UTC"
        tasks = await _run(
            tasks_service.list_tasks(
                session,
                user_id,
                list_id=_uuid(list_id, "list") if list_id else None,
                view=view,
                status_filter=status,
                timezone=timezone,
            )
        )
        return [_task_summary(t) for t in tasks]


@server.tool()
async def get_task(task_id: str) -> dict[str, Any]:
    """Get a task's full detail, including subtasks and linked notes."""
    user_id = current_user_id()
    async with async_session_factory() as session:
        task, counts, subtasks = await _run(
            tasks_service.get_task_detail(session, user_id, _uuid(task_id, "task"))
        )
        return {
            **_task_detail(task),
            "subtasks_done": counts.done,
            "subtasks_total": counts.total,
            "subtasks": [_task_summary(s) for s in subtasks],
        }


@server.tool()
async def create_task(
    title: str,
    list_id: str | None = None,
    priority: str = "none",
    due_date: str | None = None,
    due_time: str | None = None,
    description: str | None = None,
) -> dict[str, Any]:
    """Create a task. `priority`: "none"|"low"|"medium"|"high". Dates are ISO
    (`due_date`: YYYY-MM-DD, `due_time`: HH:MM). Omit `list_id` for the Inbox."""
    user_id = current_user_id()
    async with async_session_factory() as session:
        task = await _run(
            tasks_service.create_task(
                session,
                user_id,
                _validated(
                    TaskCreate,
                    title=title,
                    description=description,
                    list_id=_uuid(list_id, "list") if list_id else None,
                    priority=priority,
                    due_date=_date(due_date),
                    due_time=_time(due_time),
                ),
            )
        )
        return _task_detail(task)


@server.tool()
async def update_task(
    task_id: str,
    title: str | None = None,
    description: str | None = None,
    priority: str | None = None,
    due_date: str | None = None,
    due_time: str | None = None,
    list_id: str | None = None,
) -> dict[str, Any]:
    """Update a task. Only the fields you pass are changed; pass `due_date=""` to clear
    the due date (also clears `due_time`). `list_id` moves it to another list (from
    `list_task_lists`)."""
    user_id = current_user_id()
    async with async_session_factory() as session:
        task = await _run(
            tasks_service.update_task(
                session,
                user_id,
                _uuid(task_id, "task"),
                _validated(
                    TaskUpdate,
                    title=title,
                    description=description,
                    list_id=_uuid(list_id, "list") if list_id else None,
                    priority=priority,
                    due_date=_date(due_date) if due_date else None,
                    due_time=_time(due_time) if due_time else None,
                    clear_due_date=due_date == "",
                    clear_due_time=due_time == "",
                ),
            )
        )
        return _task_detail(task)


@server.tool()
async def complete_task(task_id: str) -> dict[str, Any]:
    """Mark a task done. A recurring task advances to its next occurrence instead."""
    user_id = current_user_id()
    async with async_session_factory() as session:
        task = await _run(
            tasks_service.complete_task(
                session, user_id, _uuid(task_id, "task"), complete_subtasks=False
            )
        )
        return _task_detail(task)


@server.tool()
async def reopen_task(task_id: str) -> dict[str, Any]:
    """Mark a done task open again."""
    user_id = current_user_id()
    async with async_session_factory() as session:
        task = await _run(tasks_service.reopen_task(session, user_id, _uuid(task_id, "task")))
        return _task_detail(task)


@server.tool()
async def delete_task(task_id: str) -> dict[str, str]:
    """Delete a task and its subtasks; their reminders are cancelled. The app has no
    trash for tasks, so to just tick one off use `complete_task` instead."""
    user_id = current_user_id()
    async with async_session_factory() as session:
        await _run(tasks_service.delete_task(session, user_id, _uuid(task_id, "task")))
        return {"status": "deleted"}


def _task_list(task_list: TaskList) -> dict[str, Any]:
    return {
        "id": str(task_list.id),
        "name": task_list.name,
        "is_inbox": task_list.is_inbox,
        "color": task_list.color.value,
        "icon": task_list.icon.value,
    }


_LIST_COLORS = ", ".join(c.value for c in TaskListColor)
_LIST_ICONS = ", ".join(i.value for i in TaskListIcon)


@server.tool()
async def list_task_lists() -> list[dict[str, Any]]:
    """List the user's task lists (id, name, color, icon), for passing as `list_id`."""
    user_id = current_user_id()
    async with async_session_factory() as session:
        lists = await _run(task_lists_service.list_task_lists(session, user_id))
        return [_task_list(list_) for list_ in lists]


@server.tool(
    description=f"""Create a task list. `color` is one of: {_LIST_COLORS} (default
palette-1); `icon` one of: {_LIST_ICONS} (default folder)."""
)
async def create_task_list(
    name: str, color: str = "palette-1", icon: str = "folder"
) -> dict[str, Any]:
    user_id = current_user_id()
    data = _validated(TaskListCreate, name=name, color=color, icon=icon)
    async with async_session_factory() as session:
        task_list = await _run(
            task_lists_service.create_task_list(session, user_id, data.name, data.color, data.icon)
        )
        return _task_list(task_list)


@server.tool(
    description=f"""Rename a task list or change its color/icon; only what you pass changes.
`color`: {_LIST_COLORS}. `icon`: {_LIST_ICONS}."""
)
async def update_task_list(
    list_id: str, name: str | None = None, color: str | None = None, icon: str | None = None
) -> dict[str, Any]:
    user_id = current_user_id()
    async with async_session_factory() as session:
        task_list = await _run(
            task_lists_service.update_task_list(
                session,
                user_id,
                _uuid(list_id, "list"),
                _validated(TaskListUpdate, name=name, color=color, icon=icon),
            )
        )
        return _task_list(task_list)


@server.tool()
async def delete_task_list(list_id: str, delete_tasks: bool = False) -> dict[str, str]:
    """Delete a task list. Its tasks move to the Inbox, unless `delete_tasks` is true —
    then they're deleted with it. The Inbox itself can't be deleted."""
    user_id = current_user_id()
    async with async_session_factory() as session:
        await _run(
            task_lists_service.delete_task_list(
                session, user_id, _uuid(list_id, "list"), delete_tasks
            )
        )
        return {"status": "deleted"}
