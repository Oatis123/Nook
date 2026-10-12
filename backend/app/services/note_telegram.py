"""Reading notes from the Telegram bot: finding them by title (`/note`) and turning a note
into a Telegram rich message (Bot API 10.1+), whose Markdown already covers what notes use
— headings, lists, task lists, tables, quotes, code and `$…$`/`$$…$$` formulas. What it
can't show — `[[wikilinks]]`, embeds, images only reachable on the LAN — is rewritten."""

import re
import uuid
from dataclasses import dataclass
from urllib.parse import urlparse

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.note import Note
from app.services import search as search_service
from app.services.note_parsing import extract_frontmatter

MAX_RESULTS = 5
# Telegram's limit for a rich message's text (formula sources included).
MAX_RICH_TEXT = 32768
# Room left under the limit for the title and the "cut short" line.
_RICH_BUDGET = MAX_RICH_TEXT - 1000
MAX_PLAIN_TEXT = 4096
# Buttons hold at most 64 bytes of text before Telegram cuts them; titles stay readable.
MAX_BUTTON_TITLE = 60


@dataclass(frozen=True)
class FoundNote:
    id: uuid.UUID
    title: str


def _like_pattern(text: str) -> str:
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


async def find_notes(
    session: AsyncSession, user_id: uuid.UUID, query: str, limit: int = MAX_RESULTS
) -> list[FoundNote]:
    """Notes whose title matches `query` — exact first, then titles starting with it, then
    containing it — topped up with full-text matches in their content. An empty query
    gives the most recently edited notes."""
    query = query.strip()
    base = select(Note.id, Note.title).where(Note.user_id == user_id, Note.deleted_at.is_(None))
    if not query:
        rows = await session.execute(base.order_by(Note.updated_at.desc()).limit(limit))
        return [FoundNote(id, title) for id, title in rows.all()]

    title = func.lower(Note.title)
    needle = query.lower()
    rank = case(
        (title == needle, 0),
        (title.startswith(needle, autoescape=True), 1),
        else_=2,
    )
    rows = await session.execute(
        base.where(Note.title.ilike(_like_pattern(query), escape="\\"))
        .order_by(rank, func.length(Note.title), Note.updated_at.desc())
        .limit(limit)
    )
    found = [FoundNote(id, title) for id, title in rows.all()]
    if len(found) < limit:
        seen = {f.id for f in found}
        filters = search_service.parse_query(query)
        for result in await search_service.search_notes(session, user_id, filters, limit=limit):
            if result.id not in seen and len(found) < limit:
                found.append(FoundNote(result.id, result.title))
    return found


def button_title(title: str) -> str:
    title = title.strip() or "Без названия"
    return title if len(title) <= MAX_BUTTON_TITLE else title[: MAX_BUTTON_TITLE - 1] + "…"


# Fenced code and inline code are left exactly as written.
_CODE_RE = re.compile(r"(^(```|~~~)[^\n]*\n.*?^\2[ \t]*$|`[^`\n]*`)", re.DOTALL | re.MULTILINE)
_EMBED_RE = re.compile(r"!\[\[([^\[\]]+)\]\]")
_WIKILINK_RE = re.compile(r"\[\[([^\[\]]+)\]\]")
_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\(([^)\s]*)(?:\s+\"[^\"]*\")?\)")


def _link_text(target: str) -> str:
    """`Note#Heading|alias` -> "alias"; `Note#Heading` -> "Note › Heading"."""
    target, _, alias = target.partition("|")
    if alias.strip():
        return alias.strip()
    note, _, heading = target.partition("#")
    note, heading = note.strip(), heading.strip().lstrip("^")
    return f"{note} › {heading}" if note and heading else note or heading


def _rewrite_prose(text: str, private_host: str | None) -> str:
    def image(match: re.Match[str]) -> str:
        alt, url = match.group(1), match.group(2)
        host = urlparse(url).hostname
        if url.startswith(("http://", "https://")) and host and host != private_host:
            return match.group(0)  # a public image Telegram can fetch itself
        return f"🖼 {alt.strip() or 'изображение'}"

    text = _EMBED_RE.sub(lambda m: f"📎 {_link_text(m.group(1))}", text)
    text = _WIKILINK_RE.sub(lambda m: f"<u>{_link_text(m.group(1))}</u>", text)
    return _IMAGE_RE.sub(image, text)


def _rewrite(body: str, private_host: str | None) -> str:
    parts = _CODE_RE.split(body)
    out: list[str] = []
    # re.split with two groups yields [text, code, fence, text, code, fence, ...].
    for index in range(0, len(parts), 3):
        out.append(_rewrite_prose(parts[index], private_host))
        if index + 1 < len(parts):
            out.append(parts[index + 1])
    return "".join(out)


def _cut(markdown: str, budget: int) -> str:
    """Cuts at the last paragraph break within `budget`, closing a code fence left open."""
    cut = markdown[:budget]
    paragraph = cut.rfind("\n\n")
    if paragraph > budget // 2:
        cut = cut[:paragraph]
    if len(re.findall(r"^(```|~~~)", cut, re.MULTILINE)) % 2:
        cut += "\n```"
    return cut


def _body(note: Note) -> str:
    _, body = extract_frontmatter(note.content)
    body = body.strip()
    # Notes often start with their own title as a heading; don't show it twice.
    first_line, _, rest = body.partition("\n")
    if first_line.lstrip("#").strip() == note.title.strip() and first_line.startswith("#"):
        body = rest.strip()
    return body


def note_rich_markdown(note: Note, public_url: str) -> tuple[str, bool]:
    """The note as rich-message Markdown, and whether it had to be cut short."""
    private_host = urlparse(public_url).hostname
    body = _rewrite(_body(note), private_host)
    truncated = len(body) > _RICH_BUDGET
    if truncated:
        body = _cut(body, _RICH_BUDGET) + "\n\n_…заметка длинная, целиком — в Nook._"
    title = note.title.strip() or "Без названия"
    return (f"# {title}\n\n{body}" if body else f"# {title}\n\n_Пустая заметка._"), truncated


def note_plain_chunks(note: Note, max_len: int = MAX_PLAIN_TEXT) -> list[str]:
    """The note as plain text, split into messages — for when Telegram won't take the
    rich message (an older client limit, HTML in the note it can't parse, ...)."""
    text = f"{note.title.strip() or 'Без названия'}\n\n{_body(note)}".strip()
    chunks: list[str] = []
    while len(text) > max_len:
        split = text.rfind("\n", 0, max_len)
        if split < max_len // 2:
            split = max_len
        chunks.append(text[:split].rstrip())
        text = text[split:].lstrip("\n")
    chunks.append(text)
    return chunks
