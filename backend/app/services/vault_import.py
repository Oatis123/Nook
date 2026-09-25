import io
import uuid
import zipfile
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath

import structlog
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.folder import Folder
from app.models.import_job import ImportJob, ImportJobStatus
from app.services import attachments as attachments_service
from app.services import folders as folders_service
from app.services import notes as notes_service

log = structlog.get_logger()

# Note titles and folder names are String(255); the "(imported N)" suffix needs room too.
MAX_IMPORTED_NAME_LENGTH = 240

# Zip-bomb protection (spec §13): an archive is rejected outright rather than partially
# processed if it exceeds either limit.
MAX_IMPORT_ENTRIES = 20_000
MAX_IMPORT_UNCOMPRESSED_MB = 1000


class ImportRejected(Exception):
    pass


def _zip_path(job_id: uuid.UUID) -> Path:
    return Path(get_settings().imports_dir) / f"{job_id}.zip"


async def create_import_job(session: AsyncSession, user_id: uuid.UUID, data: bytes) -> ImportJob:
    settings = get_settings()
    max_bytes = settings.max_import_mb * 1024 * 1024
    if len(data) > max_bytes:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"Archive exceeds the {settings.max_import_mb} MB limit"
        )
    if not zipfile.is_zipfile(io.BytesIO(data)):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "File is not a valid .zip archive")

    job = ImportJob(user_id=user_id, status=ImportJobStatus.pending)
    session.add(job)
    await session.flush()

    imports_dir = Path(settings.imports_dir)
    imports_dir.mkdir(parents=True, exist_ok=True)
    _zip_path(job.id).write_bytes(data)

    await session.commit()
    await session.refresh(job)
    return job


async def get_import_job(session: AsyncSession, user_id: uuid.UUID, job_id: uuid.UUID) -> ImportJob:
    job = await session.get(ImportJob, job_id)
    if job is None or job.user_id != user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    return job


async def process_pending_import_jobs(session: AsyncSession) -> int:
    """Called from the worker's own poll loop (spec §6.9: import runs in the background).
    FOR UPDATE SKIP LOCKED so a slow import never blocks — or gets double-picked-up by —
    another worker process/tick."""
    jobs = list(
        await session.scalars(
            select(ImportJob)
            .where(ImportJob.status == ImportJobStatus.pending)
            .with_for_update(skip_locked=True)
        )
    )
    for job in jobs:
        await process_import_job(session, job)
    return len(jobs)


def _is_safe_entry(name: str) -> bool:
    parts = PurePosixPath(name).parts
    return not PurePosixPath(name).is_absolute() and ".." not in parts


def _should_skip(name: str) -> bool:
    parts = PurePosixPath(name).parts
    return ".obsidian" in parts


async def _folder_id_for_path(
    session: AsyncSession,
    user_id: uuid.UUID,
    parts: tuple[str, ...],
    cache: dict[tuple[str, ...], uuid.UUID | None],
) -> uuid.UUID | None:
    if parts in cache:
        return cache[parts]

    parent_id = await _folder_id_for_path(session, user_id, parts[:-1], cache)
    name = parts[-1][:MAX_IMPORTED_NAME_LENGTH]

    existing_folder = await session.scalar(
        select(Folder).where(
            Folder.user_id == user_id,
            Folder.parent_id == parent_id,
            Folder.name == name,
            Folder.deleted_at.is_(None),
        )
    )
    if existing_folder is not None:
        result = existing_folder.id
    else:
        created = await folders_service.create_folder(session, user_id, name, parent_id)
        result = created.id
    cache[parts] = result
    return result


async def _import_note(
    session: AsyncSession,
    user_id: uuid.UUID,
    folder_id: uuid.UUID | None,
    title: str,
    content: str,
    report: dict,
) -> None:
    title = title[:MAX_IMPORTED_NAME_LENGTH]
    final_title = title
    for attempt in range(1, 6):
        try:
            await notes_service.create_note(session, user_id, final_title, folder_id, content)
            if attempt > 1:
                report["conflicts"].append(f'"{title}" renamed to "{final_title}"')
            report["notes_imported"] += 1
            return
        except HTTPException as exc:
            if exc.status_code != status.HTTP_409_CONFLICT:
                report["errors"].append(f'"{title}": {exc.detail}')
                return
            final_title = f"{title} (imported {attempt})"
    report["errors"].append(f'"{title}": too many title conflicts, skipped')


async def _recover(session: AsyncSession, name: str, report: dict) -> None:
    """An unexpected (non-HTTP) error while importing one entry: logs it, rolls the
    session back so the rest of the import (and the final job update) can still commit,
    and records a generic message rather than the raw exception text."""
    log.exception("import.entry_failed", entry=name)
    await session.rollback()
    report["errors"].append(f'"{name}": could not be imported')


async def process_import_job(session: AsyncSession, job: ImportJob) -> None:
    # Read up front: after a rollback the ORM object is expired, and lazily reloading
    # an attribute isn't possible in an async session.
    job_id, user_id = job.id, job.user_id
    job.status = ImportJobStatus.processing
    await session.commit()

    report: dict = {
        "notes_imported": 0,
        "attachments_imported": 0,
        "conflicts": [],
        "errors": [],
    }
    zip_path = _zip_path(job_id)
    final_status = ImportJobStatus.failed

    try:
        with zipfile.ZipFile(zip_path) as zf:
            infos = [i for i in zf.infolist() if not i.is_dir()]
            if len(infos) > MAX_IMPORT_ENTRIES:
                raise ImportRejected(f"Archive has more than {MAX_IMPORT_ENTRIES} entries")
            total_size = sum(i.file_size for i in infos)
            if total_size > MAX_IMPORT_UNCOMPRESSED_MB * 1024 * 1024:
                raise ImportRejected(
                    f"Archive is larger than {MAX_IMPORT_UNCOMPRESSED_MB} MB uncompressed"
                )

            note_entries: list[zipfile.ZipInfo] = []
            folder_cache: dict[tuple[str, ...], uuid.UUID | None] = {(): None}

            for info in infos:
                if not _is_safe_entry(info.filename) or _should_skip(info.filename):
                    continue
                if info.filename.lower().endswith(".md"):
                    note_entries.append(info)
                    continue
                filename = PurePosixPath(info.filename).name
                if not filename:
                    continue
                try:
                    data = zf.read(info)
                    await attachments_service.save_attachment(session, user_id, filename, data)
                    report["attachments_imported"] += 1
                except HTTPException as exc:
                    report["errors"].append(f'"{info.filename}": {exc.detail}')
                except Exception:  # noqa: BLE001 — one bad entry must not abort the import
                    await _recover(session, info.filename, report)

            for info in note_entries:
                path = PurePosixPath(info.filename)
                try:
                    folder_id = await _folder_id_for_path(
                        session, user_id, path.parent.parts, folder_cache
                    )
                    content = zf.read(info).decode("utf-8", errors="replace")
                    await _import_note(session, user_id, folder_id, path.stem, content, report)
                except HTTPException as exc:
                    report["errors"].append(f'"{info.filename}": {exc.detail}')
                except Exception:  # noqa: BLE001 — one bad entry must not abort the import
                    # Folders created in the rolled-back transaction are gone too.
                    folder_cache = {(): None}
                    await _recover(session, info.filename, report)

        final_status = ImportJobStatus.done
    except (zipfile.BadZipFile, ImportRejected) as exc:
        report["errors"].append(str(exc))
    except Exception:  # noqa: BLE001 — surfaced to the user via the job report, not raised
        log.exception("import.failed", job_id=str(job_id))
        await session.rollback()
        report["errors"].append("Unexpected error while importing the archive")
    finally:
        job_row = await session.get(ImportJob, job_id)
        if job_row is not None:
            job_row.status = final_status
            job_row.report = report
            job_row.finished_at = datetime.now(UTC)
            await session.commit()
        zip_path.unlink(missing_ok=True)
