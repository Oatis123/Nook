import uuid

from fastapi import APIRouter, Depends, Query, Response, status
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from app.core.deps import CurrentUser, DbSession, require_csrf
from app.schemas.note import NoteCreate, NoteDetail, NoteSummary, NoteUpdate
from app.schemas.note_link import BacklinkOut, RenameImpact
from app.schemas.task import TaskOut
from app.schemas.task_note_link import NewTaskFromNoteRequest
from app.services import note_links as note_links_service
from app.services import notes as notes_service
from app.services import task_note_links as task_note_links_service
from app.services import vault_export as vault_export_service

router = APIRouter(prefix="/notes", tags=["notes"])
Csrf = Depends(require_csrf)


@router.get("", response_model=list[NoteSummary])
async def list_notes(
    user: CurrentUser,
    session: DbSession,
    folder_id: uuid.UUID | None = Query(default=None),
    root: bool = Query(default=False),
    deleted: bool = Query(default=False),
    tag: str | None = Query(default=None),
) -> list[NoteSummary]:
    notes = await notes_service.list_notes(
        session,
        user.id,
        folder_id=None if root else folder_id,
        folder_filter=root or folder_id is not None,
        deleted=deleted,
        tag=tag,
    )
    return [NoteSummary.model_validate(n) for n in notes]


@router.post("", response_model=NoteDetail, dependencies=[Csrf])
async def create_note(body: NoteCreate, user: CurrentUser, session: DbSession) -> NoteDetail:
    note = await notes_service.create_note(
        session, user.id, body.title, body.folder_id, body.content
    )
    return await notes_service.build_note_detail(session, note)


@router.get("/export")
async def export_vault(user: CurrentUser, session: DbSession) -> FileResponse:
    path = await vault_export_service.build_vault_zip_file(session, user.id)
    return FileResponse(
        path,
        media_type="application/zip",
        filename="vault.zip",
        background=BackgroundTask(path.unlink, missing_ok=True),
    )


@router.get("/{note_id}", response_model=NoteDetail)
async def get_note(note_id: uuid.UUID, user: CurrentUser, session: DbSession) -> NoteDetail:
    note = await notes_service.get_note(session, user.id, note_id)
    return await notes_service.build_note_detail(session, note)


@router.get("/{note_id}/export")
async def export_note(note_id: uuid.UUID, user: CurrentUser, session: DbSession) -> Response:
    note = await notes_service.get_note(session, user.id, note_id)
    data = vault_export_service.export_note_markdown(note)
    filename = vault_export_service.export_note_filename(note)
    return Response(
        content=data,
        media_type="text/markdown",
        headers={"Content-Disposition": vault_export_service.content_disposition(filename)},
    )


@router.get("/{note_id}/backlinks", response_model=list[BacklinkOut])
async def get_backlinks(
    note_id: uuid.UUID, user: CurrentUser, session: DbSession
) -> list[BacklinkOut]:
    await notes_service.get_note(session, user.id, note_id)  # 404s if not owned
    links = await note_links_service.get_backlinks(session, user.id, note_id)
    return [
        BacklinkOut(source_note_id=source.id, source_note_title=source.title, heading=link.heading)
        for link, source in links
    ]


@router.get("/{note_id}/rename-impact", response_model=RenameImpact)
async def rename_impact(note_id: uuid.UUID, user: CurrentUser, session: DbSession) -> RenameImpact:
    count = await notes_service.count_rename_impact(session, user.id, note_id)
    return RenameImpact(affected_notes=count)


@router.patch("/{note_id}", response_model=NoteDetail, dependencies=[Csrf])
async def update_note(
    note_id: uuid.UUID, body: NoteUpdate, user: CurrentUser, session: DbSession
) -> NoteDetail:
    note = await notes_service.update_note(session, user.id, note_id, body)
    return await notes_service.build_note_detail(session, note)


@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Csrf])
async def delete_note(note_id: uuid.UUID, user: CurrentUser, session: DbSession) -> None:
    await notes_service.soft_delete_note(session, user.id, note_id)


@router.post("/{note_id}/restore", response_model=NoteDetail, dependencies=[Csrf])
async def restore_note(note_id: uuid.UUID, user: CurrentUser, session: DbSession) -> NoteDetail:
    note = await notes_service.restore_note(session, user.id, note_id)
    return await notes_service.build_note_detail(session, note)


@router.delete("/{note_id}/permanent", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Csrf])
async def hard_delete_note(note_id: uuid.UUID, user: CurrentUser, session: DbSession) -> None:
    await notes_service.hard_delete_note(session, user.id, note_id)


@router.post("/trash/empty", dependencies=[Csrf])
async def empty_trash(user: CurrentUser, session: DbSession) -> dict[str, int]:
    count = await notes_service.empty_trash(session, user.id)
    return {"deleted": count}


@router.post("/{note_id}/tasks", response_model=TaskOut, dependencies=[Csrf])
async def create_task_from_note(
    note_id: uuid.UUID, body: NewTaskFromNoteRequest, user: CurrentUser, session: DbSession
) -> TaskOut:
    task = await task_note_links_service.create_task_from_note(
        session, user.id, note_id, body.title
    )
    return TaskOut(
        id=task.id,
        list_id=task.list_id,
        parent_id=task.parent_id,
        title=task.title,
        priority=task.priority,
        due_date=task.due_date,
        due_time=task.due_time,
        status=task.status,
        completed_at=task.completed_at,
        reminders_enabled=task.reminders_enabled,
        position=task.position,
        subtask_done_count=0,
        subtask_total_count=0,
        is_recurring=task.is_recurring,
        rrule=task.rrule,
        recurrence_end=task.recurrence_end,
        created_at=task.created_at,
        updated_at=task.updated_at,
    )
