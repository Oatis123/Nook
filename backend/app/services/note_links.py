import re
import uuid

from sqlalchemy import delete, insert, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.folder import Folder
from app.models.note import Note
from app.models.note_alias import NoteAlias
from app.models.note_link import NoteLink
from app.models.tag import NoteTag, Tag
from app.services.note_parsing import (
    Wikilink,
    extract_frontmatter,
    extract_inline_tags,
    extract_wikilinks,
    frontmatter_aliases,
    frontmatter_tags,
)


async def _active_notes(session: AsyncSession, user_id: uuid.UUID) -> list[Note]:
    result = await session.scalars(
        select(Note)
        .options(selectinload(Note.aliases))
        .where(Note.user_id == user_id, Note.deleted_at.is_(None))
    )
    return list(result)


async def resolve_target(
    session: AsyncSession, user_id: uuid.UUID, target_raw: str, notes: list[Note] | None = None
) -> uuid.UUID | None:
    """Matches a wikilink target to exactly one active note by title or alias, or the
    `folder/Title` form (matched against the note's immediate containing folder's name —
    a one-level approximation of a full path, on the agent's discretion). Returns None
    if there's no match or more than one (ambiguous), same as a dangling link."""
    notes = notes if notes is not None else await _active_notes(session, user_id)

    folder_name = None
    title = target_raw
    if "/" in target_raw:
        folder_name, _, title = target_raw.rpartition("/")

    if folder_name:
        folders = {
            f.id: f.name
            for f in await session.scalars(
                select(Folder).where(Folder.user_id == user_id, Folder.deleted_at.is_(None))
            )
        }
        matches = [
            n
            for n in notes
            if n.title == title
            and n.folder_id is not None
            and folders.get(n.folder_id) == folder_name
        ]
    else:
        matches = [n for n in notes if n.title == title or any(a.alias == title for a in n.aliases)]

    if len(matches) == 1:
        return matches[0].id
    return None


def _dedup_links(links: list[Wikilink]) -> list[Wikilink]:
    seen: dict[tuple[str, str | None], Wikilink] = {}
    for link in links:
        seen[(link.target, link.heading)] = link
    return list(seen.values())


async def sync_note_from_content(session: AsyncSession, user_id: uuid.UUID, note: Note) -> None:
    """Re-derives frontmatter/tags/aliases/outgoing-links from `note.content`. Call after
    setting the note's content (and before commit) on every create/update."""
    frontmatter, body = extract_frontmatter(note.content)
    note.frontmatter = frontmatter

    tag_names = frontmatter_tags(frontmatter) | extract_inline_tags(body)
    existing_tags = {
        t.name: t for t in await session.scalars(select(Tag).where(Tag.user_id == user_id))
    }
    tag_ids: list[uuid.UUID] = []
    for name in tag_names:
        tag = existing_tags.get(name)
        if tag is None:
            tag = Tag(user_id=user_id, name=name)
            session.add(tag)
            await session.flush()
            existing_tags[name] = tag
        tag_ids.append(tag.id)

    await session.execute(delete(NoteTag).where(NoteTag.note_id == note.id))
    for tag_id in tag_ids:
        await session.execute(insert(NoteTag).values(note_id=note.id, tag_id=tag_id))

    aliases = frontmatter_aliases(frontmatter)
    await session.execute(delete(NoteAlias).where(NoteAlias.note_id == note.id))
    for alias in aliases:
        session.add(NoteAlias(note_id=note.id, alias=alias))

    wikilinks = _dedup_links(extract_wikilinks(body))
    notes = await _active_notes(session, user_id)
    await session.execute(delete(NoteLink).where(NoteLink.source_note_id == note.id))
    for link in wikilinks:
        target_id = await resolve_target(session, user_id, link.target, notes=notes)
        session.add(
            NoteLink(
                user_id=user_id,
                source_note_id=note.id,
                target_note_id=target_id,
                target_raw=link.target,
                heading=link.heading,
            )
        )


async def resolve_dangling_links_to(session: AsyncSession, user_id: uuid.UUID, note: Note) -> None:
    """Called after a note is created or renamed: any other note's dangling link whose
    raw target now matches this note's title/aliases gets re-resolved (spec §6.5)."""
    aliases = {a.alias for a in note.aliases} if note.aliases else set()
    candidates = {note.title, *aliases}

    dangling = await session.scalars(
        select(NoteLink).where(
            NoteLink.user_id == user_id,
            NoteLink.target_note_id.is_(None),
            NoteLink.source_note_id != note.id,
        )
    )
    notes = await _active_notes(session, user_id)
    for link in dangling:
        base_target = (
            link.target_raw.rpartition("/")[2] if "/" in link.target_raw else link.target_raw
        )
        if base_target not in candidates:
            continue
        resolved = await resolve_target(session, user_id, link.target_raw, notes=notes)
        if resolved is not None:
            link.target_note_id = resolved


async def get_backlinks(
    session: AsyncSession, user_id: uuid.UUID, note_id: uuid.UUID
) -> list[tuple[NoteLink, Note]]:
    result = await session.execute(
        select(NoteLink, Note)
        .join(Note, Note.id == NoteLink.source_note_id)
        .where(
            NoteLink.user_id == user_id,
            NoteLink.target_note_id == note_id,
            Note.deleted_at.is_(None),
        )
        .order_by(Note.title)
    )
    return [(link, source) for link, source in result.all()]


_WIKILINK_TARGET_RE_CACHE: dict[str, re.Pattern] = {}


def _wikilink_target_pattern(title: str) -> re.Pattern:
    if title not in _WIKILINK_TARGET_RE_CACHE:
        escaped = re.escape(title)
        _WIKILINK_TARGET_RE_CACHE[title] = re.compile(
            r"\[\[((?:[^\[\]/]+/)?)" + escaped + r"([#|][^\]]*)?\]\]"
        )
    return _WIKILINK_TARGET_RE_CACHE[title]


def _rewrite_links_in_content(content: str, old_title: str, new_title: str) -> str:
    pattern = _wikilink_target_pattern(old_title)

    def _replace(m: re.Match) -> str:
        prefix = m.group(1) or ""
        suffix = m.group(2) or ""
        return f"[[{prefix}{new_title}{suffix}]]"

    return pattern.sub(_replace, content)


async def notes_referencing(
    session: AsyncSession, user_id: uuid.UUID, note_id: uuid.UUID
) -> list[Note]:
    links = await get_backlinks(session, user_id, note_id)
    seen: dict[uuid.UUID, Note] = {}
    for _link, source in links:
        seen[source.id] = source
    return list(seen.values())


async def cascade_rename_links(
    session: AsyncSession, user_id: uuid.UUID, note: Note, old_title: str, new_title: str
) -> int:
    """Rewrites `[[OldTitle ...]]` to `[[NewTitle ...]]` in every note that links to
    `note`, and re-syncs their tags/aliases/links. Returns the number of notes touched."""
    referencing = await notes_referencing(session, user_id, note.id)
    for source in referencing:
        rewritten = _rewrite_links_in_content(source.content, old_title, new_title)
        if rewritten != source.content:
            source.content = rewritten
            source.version += 1
            await sync_note_from_content(session, user_id, source)
    return len(referencing)
