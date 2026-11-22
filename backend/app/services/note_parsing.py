import math
import re
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import date, datetime, time
from typing import Any
from urllib.parse import unquote

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
_EXTERNAL_SCHEME_RE = re.compile(r"^(?:https?:|data:|mailto:)", re.IGNORECASE)


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


@dataclass(frozen=True)
class MarkdownImageSpan:
    start: int
    end: int
    alt: str
    dest: str
    title_part: str
    angle_bracketed: bool


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


def _is_escaped(text: str, pos: int) -> bool:
    backslashes = 0
    i = pos - 1
    while i >= 0 and text[i] == "\\":
        backslashes += 1
        i -= 1
    return backslashes % 2 == 1


def iter_markdown_images(text: str) -> Iterator[MarkdownImageSpan]:
    """Yields standard Markdown image spans `![alt](dest "title")` in `text`, handling
    `<angle bracketed>` destinations, balanced parentheses in filenames, and optional titles."""
    n = len(text)
    idx = 0
    while idx < n:
        pos = text.find("![", idx)
        if pos == -1:
            break
        if _is_escaped(text, pos):
            idx = pos + 2
            continue

        # Scan alt text up to matching `]`
        i = pos + 2
        bracket_depth = 0
        alt_end = -1
        while i < n:
            ch = text[i]
            if ch == "\\":
                i += 2
                continue
            if ch == "[":
                bracket_depth += 1
            elif ch == "]":
                if bracket_depth == 0:
                    alt_end = i
                    break
                bracket_depth -= 1
            elif ch == "\n" and i + 1 < n and text[i + 1] == "\n":
                break
            i += 1

        if alt_end == -1 or alt_end + 1 >= n or text[alt_end + 1] != "(":
            idx = pos + 2
            continue

        j = alt_end + 2
        while j < n and text[j] in (" ", "\t", "\n", "\r"):
            j += 1
        if j >= n:
            idx = pos + 2
            continue

        angle_bracketed = False
        if text[j] == "<":
            angle_bracketed = True
            j += 1
            dest_start = j
            found_close = False
            while j < n:
                ch = text[j]
                if ch == "\\":
                    j += 2
                    continue
                if ch in ("\n", "\r"):
                    break
                if ch == ">":
                    found_close = True
                    break
                j += 1
            if not found_close:
                idx = pos + 2
                continue
            dest = text[dest_start:j]
            j += 1  # consume '>'
        else:
            dest_start = j
            paren_depth = 0
            while j < n:
                ch = text[j]
                if ch == "\\":
                    j += 2
                    continue
                if ch == "(":
                    paren_depth += 1
                elif ch == ")":
                    if paren_depth == 0:
                        break
                    paren_depth -= 1
                elif ch in (" ", "\t", "\n", "\r"):
                    break
                j += 1
            dest = text[dest_start:j]

        dest_end = j
        k = dest_end
        while k < n and text[k] in (" ", "\t", "\n", "\r"):
            k += 1

        if k < n and text[k] != ")":
            opener = text[k]
            if opener in ('"', "'"):
                k += 1
                closed = False
                while k < n:
                    if text[k] == "\\":
                        k += 2
                        continue
                    if text[k] == opener:
                        closed = True
                        k += 1
                        break
                    k += 1
                if not closed:
                    idx = pos + 2
                    continue
            elif opener == "(":
                k += 1
                closed = False
                while k < n:
                    if text[k] == "\\":
                        k += 2
                        continue
                    if text[k] == "(":
                        break
                    if text[k] == ")":
                        closed = True
                        k += 1
                        break
                    k += 1
                if not closed:
                    idx = pos + 2
                    continue
            else:
                idx = pos + 2
                continue
            while k < n and text[k] in (" ", "\t", "\n", "\r"):
                k += 1

        if k >= n or text[k] != ")":
            idx = pos + 2
            continue

        yield MarkdownImageSpan(
            start=pos,
            end=k + 1,
            alt=text[pos + 2 : alt_end],
            dest=dest,
            title_part=text[dest_end:k],
            angle_bracketed=angle_bracketed,
        )
        idx = k + 1


def clean_markdown_image_target(raw_dest: str) -> str | None:
    """Normalizes a Markdown image destination, returning None for external/data/empty targets."""
    target = raw_dest.strip()
    if not target or _EXTERNAL_SCHEME_RE.match(target):
        return None
    for sep in ("#", "?"):
        if sep in target:
            target = target.split(sep, 1)[0]
    target = unquote(target).strip().replace("\\", "/")
    if not target or _EXTERNAL_SCHEME_RE.match(target):
        return None
    return target


def extract_embeds(body: str) -> set[str]:
    """Extracts both `![[...]]` Obsidian embeds and standard Markdown image embeds
    `![alt](target)` (ignoring external/data/mailto links and code blocks)."""
    prose = _FENCED_CODE_RE.sub(" ", body)
    prose = _INLINE_CODE_RE.sub(" ", prose)

    embeds: set[str] = set()
    for match in _EMBED_RE.finditer(prose):
        inner = match.group(1)
        target = inner.partition("|")[0].partition("#")[0].strip().replace("\\", "/")
        if target:
            embeds.add(target)

    for span in iter_markdown_images(prose):
        target = clean_markdown_image_target(span.dest)
        if target:
            embeds.add(target)

    return embeds
