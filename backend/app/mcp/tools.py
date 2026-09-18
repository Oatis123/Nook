import uuid
from collections.abc import Coroutine
from datetime import date, time
from typing import Any

from fastapi import HTTPException
from mcp.server.mcpserver.exceptions import ToolError

from app.core.db import async_session_factory
from app.mcp.auth import current_user_id
from app.mcp.instance import server
from app.models.note import Note
from app.models.task import Task
from app.models.user import User
from app.schemas.note import NoteUpdate
from app.schemas.task import TaskCreate, TaskUpdate
from app.services import folders as folders_service
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
    return date.fromisoformat(value) if value else None


def _time(value: str | None) -> time | None:
    return time.fromisoformat(value) if value else None


async def _run[T](coro: Coroutine[Any, Any, T]) -> T:
    """Runs a service call, turning its `HTTPException` (the isolation helper's 404,
    a version conflict, ...) into a `ToolError` the model sees as a clean error message
    instead of a generic "Error executing tool" crash — see exceptions.py's own
    docstrings for why only `ToolError` gets to keep its message."""
    try:
        return await coro
    except HTTPException as exc:
        raise ToolError(str(exc.detail)) from exc


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
    """List the user's notes, optionally scoped to a folder or a tag. Omit both for every
    non-trashed note. Use `folder_id`/note ids from `list_folders`/`search_notes`."""
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
    async with async_session_factory() as session:
        note = await _run(
            notes_service.create_note(
                session, user_id, title, _uuid(folder_id, "folder") if folder_id else None, content
            )
        )
        return _note_summary(note)


@server.tool()
async def update_note(
    note_id: str, title: str | None = None, content: str | None = None
) -> dict[str, Any]:
    """Update a note's title and/or content. Only the fields you pass are changed."""
    user_id = current_user_id()
    nid = _uuid(note_id, "note")
    async with async_session_factory() as session:
        current = await _run(notes_service.get_note(session, user_id, nid))
        note = await _run(
            notes_service.update_note(
                session,
                user_id,
                nid,
                NoteUpdate(version=current.version, title=title, content=content),
            )
        )
        return _note_summary(note)


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
        return [
            {
                "id": str(f.id),
                "name": f.name,
                "parent_id": str(f.parent_id) if f.parent_id else None,
            }
            for f in folders
        ]


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
                TaskCreate(
                    title=title,
                    description=description,
                    list_id=_uuid(list_id, "list") if list_id else None,
                    priority=priority,  # type: ignore[arg-type]
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
) -> dict[str, Any]:
    """Update a task. Only the fields you pass are changed; pass `due_date=""` to clear
    the due date (also clears `due_time`)."""
    user_id = current_user_id()
    async with async_session_factory() as session:
        task = await _run(
            tasks_service.update_task(
                session,
                user_id,
                _uuid(task_id, "task"),
                TaskUpdate(
                    title=title,
                    description=description,
                    priority=priority,  # type: ignore[arg-type]
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
async def list_task_lists() -> list[dict[str, Any]]:
    """List the user's task lists (id, name), for passing as `list_id`."""
    user_id = current_user_id()
    async with async_session_factory() as session:
        lists = await _run(task_lists_service.list_task_lists(session, user_id))
        return [
            {"id": str(list_.id), "name": list_.name, "is_inbox": list_.is_inbox} for list_ in lists
        ]
