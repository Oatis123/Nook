import re
import uuid
import zipfile
from datetime import UTC, datetime, timedelta
from pathlib import Path, PurePosixPath
from typing import BinaryIO

import structlog
from fastapi import HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.core.config import get_settings
from app.core.errors import CodedHTTPException
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
COPY_CHUNK_BYTES = 1024 * 1024
# A note is text; anything bigger than this isn't one (and Postgres' full-text index
# can't hold it anyway).
MAX_NOTE_BYTES = 1024 * 1024
MAX_IMPORT_UNCOMPRESSED_MB = 1000


class ImportRejected(Exception):
    pass


def _zip_path(job_id: uuid.UUID) -> Path:
    return Path(get_settings().imports_dir) / f"{job_id}.zip"


def _store_upload(upload: BinaryIO, dest: Path, max_bytes: int) -> bool:
    """Copies the uploaded archive to disk in chunks (it can be hundreds of MB — never
    held in memory) and checks it's a zip. Returns False if it's too large."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    with dest.open("wb") as out:
        while chunk := upload.read(COPY_CHUNK_BYTES):
            written += len(chunk)
            if written > max_bytes:
                return False
            out.write(chunk)
    return True


async def create_import_job(
    session: AsyncSession, user_id: uuid.UUID, upload: UploadFile
) -> ImportJob:
    settings = get_settings()
    active = await session.scalar(
        select(ImportJob.id).where(
            ImportJob.user_id == user_id,
            ImportJob.status.in_([ImportJobStatus.pending, ImportJobStatus.processing]),
        )
    )
    if active is not None:
        raise CodedHTTPException(
            status.HTTP_409_CONFLICT,
            "import_in_progress",
            "An import is already running — wait for it to finish first.",
        )

    job = ImportJob(user_id=user_id, status=ImportJobStatus.pending)
    session.add(job)
    await session.flush()

    dest = _zip_path(job.id)
    try:
        fits = await run_in_threadpool(
            _store_upload, upload.file, dest, settings.max_import_mb * 1024 * 1024
        )
        if not fits:
            raise CodedHTTPException(
                status.HTTP_413_CONTENT_TOO_LARGE,
                "file_too_large",
                f"Archive exceeds the {settings.max_import_mb} MB limit",
            )
        if not await run_in_threadpool(zipfile.is_zipfile, dest):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "File is not a valid .zip archive")
    except BaseException:
        await session.rollback()
        dest.unlink(missing_ok=True)
        raise

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


INTERRUPTED_MESSAGE = (
    "The import was interrupted by a server restart. Notes imported before that were kept; "
    "upload the archive again to import the rest (existing titles get renamed, not replaced)."
)


async def fail_interrupted_import_jobs(
    session: AsyncSession, older_than: timedelta | None = None
) -> int:
    """A job still `processing` when the worker starts was cut off by a restart (the
    worker is the only thing that processes imports); with `older_than`, the worker's
    periodic sweep also fails jobs stuck for that long (e.g. the database connection
    dropped mid-import). Otherwise they'd show as in progress forever — and block new
    imports. Failed rather than re-queued: re-running would duplicate imported notes."""
    query = select(ImportJob).where(ImportJob.status == ImportJobStatus.processing)
    if older_than is not None:
        query = query.where(ImportJob.created_at < datetime.now(UTC) - older_than)
    jobs = list(await session.scalars(query))
    for job in jobs:
        report = dict(job.report or {})
        report["errors"] = [*report.get("errors", []), INTERRUPTED_MESSAGE]
        job.report = report
        job.status = ImportJobStatus.failed
        job.finished_at = datetime.now(UTC)
        _zip_path(job.id).unlink(missing_ok=True)
    await session.commit()
    return len(jobs)


_EMBED_TARGET_RE = re.compile(r"!\[\[([^\[\]|#]+)([|#][^\[\]]*)?\]\]")


def rewrite_embeds(content: str, names: dict[str, str]) -> str:
    """Points `![[file]]` / `![[path/file|alias]]` at the name the file was actually
    stored under. Obsidian may reference an attachment by bare name or by vault path."""
    if not names:
        return content

    def replace(match: re.Match[str]) -> str:
        target = match.group(1).strip()
        new = names.get(target) or names.get(PurePosixPath(target).name)
        if new is None or new == target:
            return match.group(0)
        return f"![[{new}{match.group(2) or ''}]]"

    return _EMBED_TARGET_RE.sub(replace, content)


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
            embed_names: dict[str, str] = {}
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
                # Checked before reading: the entry is decompressed fully into memory,
                # so a small archive of highly compressible data could otherwise
                # balloon the worker by up to the archive's whole uncompressed size.
                if info.file_size > attachments_service.max_upload_bytes():
                    report["errors"].append(
                        f'"{info.filename}": larger than the '
                        f"{get_settings().max_upload_mb} MB attachment limit, skipped"
                    )
                    continue
                try:
                    data = zf.read(info)
                    existing = await attachments_service.find_identical(
                        session, user_id, filename, data
                    )
                    if existing is not None:
                        # Re-importing the same file (e.g. the same vault twice) reuses it
                        # instead of piling up "image (2).png" copies.
                        saved_name = existing.filename
                    else:
                        saved = await attachments_service.save_attachment(
                            session, user_id, filename, data
                        )
                        saved_name = saved.filename
                    # Notes embed attachments by name; if this one had to be renamed
                    # (the user already has a different "image.png"), the vault's notes
                    # are rewritten below to point at the renamed file, not the other one.
                    embed_names.setdefault(filename, saved_name)
                    embed_names.setdefault(info.filename, saved_name)
                    report["attachments_imported"] += 1
                except HTTPException as exc:
                    report["errors"].append(f'"{info.filename}": {exc.detail}')
                except Exception:  # noqa: BLE001 — one bad entry must not abort the import
                    await _recover(session, info.filename, report)

            for info in note_entries:
                path = PurePosixPath(info.filename)
                if info.file_size > MAX_NOTE_BYTES:
                    report["errors"].append(f'"{info.filename}": larger than 1 MB, skipped')
                    continue
                try:
                    folder_id = await _folder_id_for_path(
                        session, user_id, path.parent.parts, folder_cache
                    )
                    content = zf.read(info).decode("utf-8", errors="replace")
                    content = rewrite_embeds(content.replace("\x00", ""), embed_names)
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
        zip_path.unlink(missing_ok=True)
        try:
            job_row = await session.get(ImportJob, job_id)
            if job_row is not None:
                job_row.status = final_status
                job_row.report = report
                job_row.finished_at = datetime.now(UTC)
                await session.commit()
        except Exception:
            # E.g. the database connection dropped: the job stays "processing" until the
            # worker's periodic sweep (fail_interrupted_import_jobs) fails it.
            log.exception("import.finalize_failed", job_id=str(job_id))
