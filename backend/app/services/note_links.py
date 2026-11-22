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
    return (await resolve_targets(session, user_id, {target_raw})).get(target_raw)


async def resolve_targets(
    session: AsyncSession, user_id: uuid.UUID, targets: set[str]
) -> dict[str, uuid.UUID]:
    """Resolve only unambiguous wikilinks, with one shared set of note candidates."""
    candidates, folders = await _load_candidates(
        session, user_id, {_split_target(target)[1] for target in targets}
    )
    return {
        target: note_id
        for target in targets
        if (note_id := _match_target(target, candidates, folders)) is not None
    }


def _dedup_links(links: list[Wikilink]) -> list[Wikilink]:
    """Also clips target/heading to their column length, so an absurdly long `[[...]]`
    is stored (truncated) rather than failing the whole save."""
    seen: dict[tuple[str, str | None], Wikilink] = {}
    for link in links:
        target = clip_name(link.target)
        heading = clip_name(link.heading) if link.heading is not None else None
        seen[(target, heading)] = Wikilink(target=target, heading=heading, alias=link.alias)
    return list(seen.values())


async def _load_folder_tree(
    session: AsyncSession, user_id: uuid.UUID
) -> tuple[dict[uuid.UUID | None, tuple[str, ...]], dict[tuple[str, ...], list[uuid.UUID | None]]]:
    rows = (
        await session.execute(
            select(Folder.id, Folder.name, Folder.parent_id).where(
                Folder.user_id == user_id, Folder.deleted_at.is_(None)
            )
        )
    ).all()
    by_id = {row.id: (row.name, row.parent_id) for row in rows}
    folder_paths: dict[uuid.UUID | None, tuple[str, ...]] = {None: ()}
    path_to_ids: dict[tuple[str, ...], list[uuid.UUID | None]] = {(): [None]}

    for fid in by_id:
        segments: list[str] = []
        seen: set[uuid.UUID] = set()
        curr: uuid.UUID | None = fid
        while curr is not None and curr not in seen:
            entry = by_id.get(curr)
            if entry is None:
                break
            seen.add(curr)
            name, parent_id = entry
            segments.append(name)
            curr = parent_id
        path = tuple(reversed(segments))
        folder_paths[fid] = path
        path_to_ids.setdefault(path, []).append(fid)

    return folder_paths, path_to_ids


def _resolve_embed_ids(
    target: str,
    note_folder_id: uuid.UUID | None,
    note_folder_path: tuple[str, ...],
    folder_paths: dict[uuid.UUID | None, tuple[str, ...]],
    path_to_ids: dict[tuple[str, ...], list[uuid.UUID | None]],
    by_folder_and_name: dict[tuple[uuid.UUID | None, str], list[uuid.UUID]],
    by_name: dict[str, list[uuid.UUID]],
) -> list[uuid.UUID]:
    norm = target.replace("\\", "/").strip()
    if "/" in norm:
        dir_raw, _, filename = norm.rpartition("/")
        is_abs = norm.startswith("/")
        raw_parts = [p for p in dir_raw.split("/") if p and p != "."]

        # 1. Path relative to note's folder (handles ../images/file.gif and ./file.gif)
        if not is_abs:
            rel_parts = list(note_folder_path)
            rel_valid = True
            for part in raw_parts:
                if part == "..":
                    if not rel_parts:
                        rel_valid = False
                        break
                    rel_parts.pop()
                else:
                    rel_parts.append(part)
            if rel_valid:
                matched: list[uuid.UUID] = []
                for fid in path_to_ids.get(tuple(rel_parts), ()):
                    matched.extend(by_folder_and_name.get((fid, filename), ()))
                if matched:
                    return matched

        # 2. Vault-root path (e.g. images/file.gif) and 3. unambiguous suffix folder match
        if ".." not in raw_parts:
            vault_matched: list[uuid.UUID] = []
            for fid in path_to_ids.get(tuple(raw_parts), ()):
                vault_matched.extend(by_folder_and_name.get((fid, filename), ()))
            if vault_matched:
                return vault_matched

            if raw_parts:
                suffix = tuple(raw_parts)
                suffix_matches: list[list[uuid.UUID]] = []
                for (fid, name), ids in by_folder_and_name.items():
                    if name != filename or fid is None:
                        continue
                    fpath = folder_paths.get(fid, ())
                    if len(fpath) >= len(suffix) and fpath[-len(suffix) :] == suffix:
                        suffix_matches.append(ids)
                if len(suffix_matches) == 1:
                    return suffix_matches[0]
    else:
        filename = norm
        same_folder = by_folder_and_name.get((note_folder_id, filename), [])
        if same_folder:
            return same_folder

    all_matches = by_name.get(filename, [])
    if len(all_matches) == 1:
        return all_matches
    return []


async def _sync_note_attachments(
    session: AsyncSession, user_id: uuid.UUID, note: Note, body: str
) -> None:
    embed_targets = _capped(extract_embeds(body))
    await session.execute(delete(NoteAttachment).where(NoteAttachment.note_id == note.id))
    if not embed_targets:
        return

    filenames = {t.replace("\\", "/").strip().rsplit("/", 1)[-1] for t in embed_targets}
    attachments = (
        await session.execute(
            select(Attachment.id, Attachment.filename, Attachment.folder_id).where(
                Attachment.user_id == user_id, Attachment.filename.in_(filenames)
            )
        )
    ).all()
    if not attachments:
        return

    by_folder_and_name: dict[tuple[uuid.UUID | None, str], list[uuid.UUID]] = {}
    by_name: dict[str, list[uuid.UUID]] = {}
    for attachment_id, filename, folder_id in attachments:
        by_folder_and_name.setdefault((folder_id, filename), []).append(attachment_id)
        by_name.setdefault(filename, []).append(attachment_id)

    needs_tree = any("/" in t for t in embed_targets) or any(
        row.folder_id is not None for row in attachments
    )
    if needs_tree:
        folder_paths, path_to_ids = await _load_folder_tree(session, user_id)
    else:
        folder_paths = {None: ()}
        path_to_ids = {(): [None]}

    note_folder_path = folder_paths.get(note.folder_id, ())
    resolved_ids: set[uuid.UUID] = set()
    for target in embed_targets:
        resolved_ids.update(
            _resolve_embed_ids(
                target,
                note.folder_id,
                note_folder_path,
                folder_paths,
                path_to_ids,
                by_folder_and_name,
                by_name,
            )
        )

    for attachment_id in resolved_ids:
        await session.execute(
            insert(NoteAttachment).values(note_id=note.id, attachment_id=attachment_id)
        )


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

    await _sync_note_attachments(session, user_id, note, body)


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
