from app.services.note_parsing import (
    extract_frontmatter,
    extract_inline_tags,
    extract_wikilinks,
    frontmatter_aliases,
    frontmatter_tags,
)


def test_extract_frontmatter_parses_yaml_block() -> None:
    content = "---\ntags: [a, b]\naliases:\n  - Foo\n---\nBody text"
    frontmatter, body = extract_frontmatter(content)
    assert frontmatter == {"tags": ["a", "b"], "aliases": ["Foo"]}
    assert body == "Body text"


def test_extract_frontmatter_absent_returns_full_content() -> None:
    frontmatter, body = extract_frontmatter("# No frontmatter here")
    assert frontmatter == {}
    assert body == "# No frontmatter here"


def test_frontmatter_tags_accepts_single_string_or_list() -> None:
    assert frontmatter_tags({"tags": "solo"}) == {"solo"}
    assert frontmatter_tags({"tags": ["a", "b"]}) == {"a", "b"}
    assert frontmatter_tags({}) == set()


def test_frontmatter_aliases_accepts_single_string_or_list() -> None:
    assert frontmatter_aliases({"aliases": "Solo"}) == {"Solo"}
    assert frontmatter_aliases({"aliases": ["A", "B"]}) == {"A", "B"}


def test_extract_inline_tags_matches_simple_and_nested() -> None:
    body = "This has #simple and #parent/child tags."
    assert extract_inline_tags(body) == {"simple", "parent/child"}


def test_extract_inline_tags_ignores_headers() -> None:
    body = "# Heading one\n\nSome text with no tags."
    assert extract_inline_tags(body) == set()


def test_extract_inline_tags_ignores_code() -> None:
    body = "Inline `#not_a_tag` and:\n\n```\n#also_not_a_tag\n```\n\nReal #tag here."
    assert extract_inline_tags(body) == {"tag"}


def test_extract_inline_tags_ignores_numeric_only() -> None:
    body = "Issue #123 is not a tag, but #v2 is."
    assert extract_inline_tags(body) == {"v2"}


def test_extract_wikilinks_all_forms() -> None:
    body = (
        "[[Simple]] and [[Note|Alias]] and [[Note#Heading]] "
        "and [[Note#Heading|Alias]] and [[folder/Note]]"
    )
    links = extract_wikilinks(body)
    assert [(link.target, link.heading, link.alias) for link in links] == [
        ("Simple", None, None),
        ("Note", None, "Alias"),
        ("Note", "Heading", None),
        ("Note", "Heading", "Alias"),
        ("folder/Note", None, None),
    ]


def test_extract_wikilinks_ignores_code() -> None:
    body = "Inline `[[NotALink]]` and:\n\n```\n[[AlsoNotALink]]\n```\n\n[[RealLink]]"
    links = extract_wikilinks(body)
    assert [link.target for link in links] == ["RealLink"]
