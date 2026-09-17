import re
from dataclasses import dataclass

import yaml

_FRONTMATTER_RE = re.compile(r"\A---\r?\n(.*?)\r?\n---\r?\n?", re.DOTALL)
_FENCED_CODE_RE = re.compile(r"```.*?```|~~~.*?~~~", re.DOTALL)
_INLINE_CODE_RE = re.compile(r"`[^`\n]*`")
_MARKDOWN_LINK_URL_RE = re.compile(r"\]\((https?://[^)]*|[^)]*)\)")
_BARE_URL_RE = re.compile(r"https?://\S+")
_TAG_RE = re.compile(r"(?<![\w#/])#([A-Za-z][\w-]*(?:/[A-Za-z][\w-]*)*)")
_WIKILINK_RE = re.compile(r"\[\[([^\[\]]+)\]\]")


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
    return data, content[match.end() :]


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
