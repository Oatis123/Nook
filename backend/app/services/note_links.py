import re
import uuid
from dataclasses import dataclass

from sqlalchemy import delete, insert, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.attachment import Attachment, NoteAttachment
from app.models.folder import Folder
from app.models.note import Note
from app.models.note_alias import NoteAlias
from app.models.note_link import NoteLink
from app.models.tag import NoteTag, Tag
from app.services.note_parsing import (
    Wikilink,
    clip_name,
    extract_embeds,
    extract_frontmatter,
    extract_inline_tags,
    extract_wikilinks,
    frontmatter_aliases,
    frontmatter_tags,
)

# Per note, per kind (tags, aliases, links, embeds). Far beyond any real note, but it
# keeps every lookup's bind parameters under Postgres' 32767 limit — a pasted list of
# tens of thousands of [[links]] used to fail every save with a 500.
MAX_ITEMS_PER_NOTE = 2000


def _capped(items: set[str]) -> set[str]:
    return items if len(items) <= MAX_ITEMS_PER_NOTE else set(sorted(items)[:MAX_ITEMS_PER_NOTE])


@dataclass(frozen=True)
class _Candidate:
    id: uuid.UUID
    title: str
    folder_id: uuid.UUID | None
    aliases: frozenset[str]


def _split_target(target_raw: str) -> tuple[str | None, str]:
    """`folder/Title` → ("folder", "Title"); a plain `Title` → (None, "Title")."""
    if "/" in target_raw:
        folder_name, _, title = target_raw.rpartition("/")
        return folder_name or None, title
    return None, target_raw


async def _load_candidates(
    session: AsyncSession, user_id: uuid.UUID, names: set[str]
) -> tuple[list[_Candidate], dict[uuid.UUID, str]]:
    """Only the active notes whose title or an alias is one of `names` (plus their folder
    names) — never the whole vault, so saving a note stays cheap however many notes the
    user has."""
    if not names:
        return [], {}
    alias_note_ids = select(NoteAlias.note_id).where(NoteAlias.alias.in_(names))
    rows = (
        await session.execute(
            select(Note.id, Note.title, Note.folder_id).where(
                Note.user_id == user_id,
                Note.deleted_at.is_(None),
                or_(Note.title.in_(names), Note.id.in_(alias_note_ids)),
            )
        )
    ).all()
    if not rows:
        return [], {}

    aliases: dict[uuid.UUID, set[str]] = {}
    alias_rows = await session.execute(
        select(NoteAlias.note_id, NoteAlias.alias).where(
            NoteAlias.note_id.in_([row.id for row in rows])
        )
    )
    for note_id, alias in alias_rows.all():
        aliases.setdefault(note_id, set()).add(alias)

    folder_ids = {row.folder_id for row in rows if row.folder_id is not None}
    folders: dict[uuid.UUID, str] = {}
    if folder_ids:
        folder_rows = await session.execute(
            select(Folder.id, Folder.name).where(
                Folder.id.in_(folder_ids), Folder.deleted_at.is_(None)
            )
        )
        folders = {folder_id: name for folder_id, name in folder_rows.all()}

    candidates = [
        _Candidate(row.id, row.title, row.folder_id, frozenset(aliases.get(row.id, ())))
        for row in rows
    ]
    return candidates, folders


def _match_target(
    target_raw: str, candidates: list[_Candidate], folders: dict[uuid.UUID, str]
) -> uuid.UUID | None:
    folder_name, title = _split_target(target_raw)
    if folder_name:
        matches = [
            c
            for c in candidates
            if c.title == title
            and c.folder_id is not None
            and folders.get(c.folder_id) == folder_name
        ]
    else:
        matches = [c for c in candidates if c.title == title or title in c.aliases]
    if len(matches) == 1:
        return matches[0].id
    return None


async def resolve_target(
    session: AsyncSession, user_id: uuid.UUID, target_raw: str
) -> uuid.UUID | None:
    """Matches a wikilink target to exactly one active note by title or alias, or the
    `folder/Title` form (matched against the note's immediate containing folder's name —
    a one-level approximation of a full path, on the agent's discretion). Returns None
    if there's no match or more than one (ambiguous), same as a dangling link."""
    candidates, folders = await _load_candidates(session, user_id, {_split_target(target_raw)[1]})
    return _match_target(target_raw, candidates, folders)


def _dedup_links(links: list[Wikilink]) -> list[Wikilink]:
    """Also clips target/heading to their column length, so an absurdly long `[[...]]`
    is stored (truncated) rather than failing the whole save."""
    seen: dict[tuple[str, str | None], Wikilink] = {}
    for link in links:
        target = clip_name(link.target)
        heading = clip_name(link.heading) if link.heading is not None else None
        seen[(target, heading)] = Wikilink(target=target, heading=heading, alias=link.alias)
    return list(seen.values())


async def sync_note_from_content(session: AsyncSession, user_id: uuid.UUID, note: Note) -> None:
    """Re-derives frontmatter/tags/aliases/outgoing-links from `note.content`. Call after
    setting the note's content (and before commit) on every create/update."""
    frontmatter, body = extract_frontmatter(note.content)
    note.frontmatter = frontmatter

    tag_names = _capped(
        {clip_name(t) for t in frontmatter_tags(frontmatter) | extract_inline_tags(body)}
    )
    existing_tags: dict[str, Tag] = {}
    if tag_names:
        existing_tags = {
            t.name: t
            for t in await session.scalars(
                select(Tag).where(Tag.user_id == user_id, Tag.name.in_(tag_names))
            )
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

    aliases = _capped({clip_name(a) for a in frontmatter_aliases(frontmatter)})
    await session.execute(delete(NoteAlias).where(NoteAlias.note_id == note.id))
    for alias in aliases:
        session.add(NoteAlias(note_id=note.id, alias=alias))

    wikilinks = _dedup_links(extract_wikilinks(body))[:MAX_ITEMS_PER_NOTE]
    await session.execute(delete(NoteLink).where(NoteLink.source_note_id == note.id))
    candidates, folders = await _load_candidates(
        session, user_id, {_split_target(link.target)[1] for link in wikilinks}
    )
    for link in wikilinks:
        session.add(
            NoteLink(
                user_id=user_id,
                source_note_id=note.id,
                target_note_id=_match_target(link.target, candidates, folders),
                target_raw=link.target,
                heading=link.heading,
            )
        )

    embed_filenames = _capped(extract_embeds(body))
    await session.execute(delete(NoteAttachment).where(NoteAttachment.note_id == note.id))
    if embed_filenames:
        attachments = await session.execute(
            select(Attachment.id, Attachment.filename).where(
                Attachment.user_id == user_id, Attachment.filename.in_(embed_filenames)
            )
        )
        by_filename: dict[str, list[uuid.UUID]] = {}
        for attachment_id, filename in attachments.all():
            by_filename.setdefault(filename, []).append(attachment_id)
        for filename in embed_filenames:
            # Every same-named attachment counts as used — the embed can't pick between
            # them (duplicates predating unique names), but "delete unused" must not
            # delete any of them either.
            for attachment_id in by_filename.get(filename, []):
                await session.execute(
                    insert(NoteAttachment).values(note_id=note.id, attachment_id=attachment_id)
                )


async def resolve_dangling_links_to(session: AsyncSession, user_id: uuid.UUID, note: Note) -> None:
    """Called after a note is created or renamed: any other note's dangling link whose
    raw target now matches this note's title/aliases gets re-resolved (spec §6.5)."""
    aliases = {a.alias for a in note.aliases} if note.aliases else set()
    names = {note.title, *aliases}

    dangling = list(
        await session.scalars(
            select(NoteLink).where(
                NoteLink.user_id == user_id,
                NoteLink.target_note_id.is_(None),
                NoteLink.source_note_id != note.id,
                or_(
                    NoteLink.target_raw.in_(names),
                    *(NoteLink.target_raw.endswith(f"/{name}", autoescape=True) for name in names),
                ),
            )
        )
    )
    if not dangling:
        return
    candidates, folders = await _load_candidates(
        session, user_id, {_split_target(link.target_raw)[1] for link in dangling}
    )
    for link in dangling:
        resolved = _match_target(link.target_raw, candidates, folders)
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
