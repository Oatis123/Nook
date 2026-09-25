import math
import re
from dataclasses import dataclass
from datetime import date, datetime, time
from typing import Any

import yaml

# Matches the String(255) columns that tags, aliases and link targets are stored in.
MAX_NAME_LENGTH = 255

_FRONTMATTER_RE = re.compile(r"\A---\r?\n(.*?)\r?\n---\r?\n?", re.DOTALL)
_FENCED_CODE_RE = re.compile(r"```.*?```|~~~.*?~~~", re.DOTALL)
_INLINE_CODE_RE = re.compile(r"`[^`\n]*`")
_MARKDOWN_LINK_URL_RE = re.compile(r"\]\((https?://[^)]*|[^)]*)\)")
_BARE_URL_RE = re.compile(r"https?://\S+")
# `[^\W\d_]` is "any Unicode letter", so `#заметка` is a tag just like `#note`.
_TAG_RE = re.compile(r"(?<![\w#/])#([^\W\d_][\w-]*(?:/[^\W\d_][\w-]*)*)")
_WIKILINK_RE = re.compile(r"(?<!!)\[\[([^\[\]]+)\]\]")
_EMBED_RE = re.compile(r"!\[\[([^\[\]]+)\]\]")


def _json_safe(value: Any) -> Any:
    """YAML happily produces values JSONB can't store — `created: 2024-01-01` becomes a
    `datetime.date`, `.nan` a float NaN, `? [a, b]` a non-string key. Normalizes the
    parsed frontmatter into plain JSON types (dates as ISO strings)."""
    if value is None or isinstance(value, bool | int | str):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else str(value)
    if isinstance(value, datetime | date | time):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(_json_safe(k)): _json_safe(v) for k, v in value.items()}
    if isinstance(value, list | tuple | set):
        return [_json_safe(v) for v in value]
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return str(value)


def clip_name(value: str) -> str:
    return value[:MAX_NAME_LENGTH]


def extract_frontmatter(content: str) -> tuple[dict, str]:
    """Returns (frontmatter dict, content with the frontmatter block removed)."""
    match = _FRONTMATTER_RE.match(content)
    if not match:
        return {}, content
    try:
        data = yaml.safe_load(match.group(1))
    except yaml.YAMLError:
        return {}, content
    if not isinstance(data, dict):
        return {}, content
    return _json_safe(data), content[match.end() :]


def _strip_non_prose(text: str) -> str:
    """Removes code (fenced/inline) and URLs so they can't be mistaken for tags."""
    text = _FENCED_CODE_RE.sub(" ", text)
    text = _INLINE_CODE_RE.sub(" ", text)
    text = _MARKDOWN_LINK_URL_RE.sub("]( )", text)
    text = _BARE_URL_RE.sub(" ", text)
    return text


def extract_inline_tags(body: str) -> set[str]:
    prose = _strip_non_prose(body)
    return {m.group(1) for m in _TAG_RE.finditer(prose)}


def frontmatter_tags(frontmatter: dict) -> set[str]:
    raw = frontmatter.get("tags")
    if raw is None:
        return set()
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, list):
        return set()
    return {str(t).strip() for t in raw if str(t).strip()}


def frontmatter_aliases(frontmatter: dict) -> set[str]:
    raw = frontmatter.get("aliases")
    if raw is None:
        return set()
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, list):
        return set()
    return {str(a).strip() for a in raw if str(a).strip()}


@dataclass(frozen=True)
class Wikilink:
    target: str
    heading: str | None
    alias: str | None


def extract_wikilinks(body: str) -> list[Wikilink]:
    prose = _FENCED_CODE_RE.sub(" ", body)
    prose = _INLINE_CODE_RE.sub(" ", prose)
    links = []
    for match in _WIKILINK_RE.finditer(prose):
        inner = match.group(1)
        target_part, _, alias = inner.partition("|")
        target, _, heading = target_part.partition("#")
        target = target.strip()
        if not target:
            continue
        links.append(
            Wikilink(
                target=target,
                heading=heading.strip() or None,
                alias=alias.strip() or None,
            )
        )
    return links


def extract_embeds(body: str) -> set[str]:
    """`![[filename]]` — image/file embeds (spec §6.3), tracked separately from regular
    wikilinks so an embedded attachment doesn't also show up as a dangling note link."""
    prose = _FENCED_CODE_RE.sub(" ", body)
    prose = _INLINE_CODE_RE.sub(" ", prose)
    return {match.group(1).strip() for match in _EMBED_RE.finditer(prose) if match.group(1).strip()}
