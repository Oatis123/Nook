from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from aiogram.exceptions import TelegramBadRequest
from aiogram.methods import SendRichMessage
from aiogram.types import CallbackQuery, Message
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.note import Note
from app.services import note_telegram
from app.services import notes as notes_service
from bot import handlers
from tests.conftest import make_user
from tests.test_bot_new_task import _bot_uses_test_db, _chat, _mock  # noqa: F401

PUBLIC_URL = "http://nook.local"


def _note(title: str, content: str) -> Note:
    return Note(title=title, content=content)


async def _make_notes(db_session: AsyncSession, user_id: Any, *titles: str) -> dict[str, Note]:
    return {
        title: await notes_service.create_note(db_session, user_id, title, None, f"About {title}")
        for title in titles
    }


async def test_find_notes_ranks_title_matches_and_tops_up_from_content(
    db_session: AsyncSession,
) -> None:
    alice = await make_user(db_session, "alice")
    bob = await make_user(db_session, "bob")
    await _make_notes(db_session, alice.id, "Reading list 2026", "Reading", "My reading_log")
    await notes_service.create_note(
        db_session, alice.id, "Books", None, "Everything about reading habits"
    )
    await _make_notes(db_session, bob.id, "Reading for bob")

    found = await note_telegram.find_notes(db_session, alice.id, "reading")
    assert [n.title for n in found] == ["Reading", "Reading list 2026", "My reading_log", "Books"]

    # LIKE wildcards in the query are taken literally.
    assert [n.title for n in await note_telegram.find_notes(db_session, alice.id, "g_l")] == [
        "My reading_log"
    ]
    recent = await note_telegram.find_notes(db_session, alice.id, "")
    assert len(recent) == 4
    assert await note_telegram.find_notes(db_session, alice.id, "zzz") == []


def test_rich_markdown_rewrites_what_telegram_cannot_show() -> None:
    note = _note(
        "Plan",
        "---\ntags: [a]\n---\n# Plan\n\nSee [[Roadmap#Q4|the roadmap]] and [[Ideas]].\n"
        "![[scan.pdf]]\n![chart](/api/v1/attachments/1) ![cat](https://example.com/cat.png)\n"
        "![lan](http://nook.local/x.png)\n\n- [x] done $x^2$\n\n"
        "```python\nprint('[[not a link]]')\n```\n`[[inline]]`",
    )
    markdown, truncated = note_telegram.note_rich_markdown(note, PUBLIC_URL)
    assert not truncated
    assert markdown.startswith("# Plan\n\nSee <u>the roadmap</u> and <u>Ideas</u>.")
    assert "tags:" not in markdown and markdown.count("# Plan") == 1
    assert "📎 scan.pdf" in markdown
    assert "🖼 chart" in markdown and "🖼 lan" in markdown
    assert "![cat](https://example.com/cat.png)" in markdown
    assert "- [x] done $x^2$" in markdown
    assert "print('[[not a link]]')" in markdown and "`[[inline]]`" in markdown


def test_long_notes_are_cut_without_leaving_a_code_fence_open() -> None:
    body = "intro\n\n```\n" + "x = 1\n" * 10000 + "```\n"
    markdown, truncated = note_telegram.note_rich_markdown(_note("Big", body), PUBLIC_URL)
    assert truncated
    assert len(markdown) <= note_telegram.MAX_RICH_TEXT
    assert markdown.count("```") % 2 == 0
    assert markdown.endswith("целиком — в Nook._")


def test_plain_chunks_fit_telegram_messages() -> None:
    chunks = note_telegram.note_plain_chunks(_note("Big", "line\n" * 3000))
    assert len(chunks) > 1
    assert all(len(c) <= note_telegram.MAX_PLAIN_TEXT for c in chunks)
    assert chunks[0].startswith("Big\n\nline")


def _callback(telegram_id: int, data: str) -> tuple[Any, Any]:
    callback = _mock(CallbackQuery)
    callback.data = data
    callback.from_user = MagicMock(id=telegram_id)
    message = _mock(Message)
    message.answer_rich = AsyncMock()
    callback.message = message
    return callback, message


async def test_note_command_lists_matches_and_a_tap_sends_the_note(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    # The test settings' PUBLIC_URL is localhost, which Telegram won't take in a button.
    monkeypatch.setattr(handlers, "_note_url", lambda note_id: f"{PUBLIC_URL}/notes/{note_id}")
    chat = await _chat(db_session)
    alice_id = (await handlers._linked_user(chat.telegram_id)).id  # type: ignore[union-attr]
    notes = await _make_notes(db_session, alice_id, "Gym plan", "Gym log", "Cooking")

    await chat.command("note", "gym")
    assert chat.last.text == "Заметки по «gym»:"
    assert chat.buttons() == ["Gym log", "Gym plan"]
    assert chat.last.reply_markup.inline_keyboard[1][0].callback_data == (
        f"nv:{notes['Gym plan'].id}"
    )

    await chat.command("note", "nothing like it")
    assert chat.last.text == "Не нашёл заметок по «nothing like it»."
    await chat.command("note")
    assert chat.last.text == handlers.RECENT_NOTES_HEADER
    assert len(chat.buttons()) == 3

    callback, message = _callback(chat.telegram_id, f"nv:{notes['Gym plan'].id}")
    await handlers.handle_note_view(callback)
    [call] = message.answer_rich.await_args_list
    assert call.args[0].markdown == "# Gym plan\n\nAbout Gym plan"
    [[open_button]] = call.kwargs["reply_markup"].inline_keyboard
    assert open_button.url.endswith(f"/notes/{notes['Gym plan'].id}")


async def test_a_note_telegram_rejects_goes_out_as_plain_text(db_session: AsyncSession) -> None:
    chat = await _chat(db_session)
    alice_id = (await handlers._linked_user(chat.telegram_id)).id  # type: ignore[union-attr]
    [note] = (await _make_notes(db_session, alice_id, "Odd")).values()

    callback, message = _callback(chat.telegram_id, f"nv:{note.id}")
    message.answer_rich.side_effect = TelegramBadRequest(
        method=SendRichMessage(chat_id=1, rich_message={"markdown": "x"}),
        message="Bad Request: can't parse rich message",
    )
    await handlers.handle_note_view(callback)
    [call] = message.answer.await_args_list
    assert call.args[0] == "Odd\n\nAbout Odd"
    assert call.kwargs["parse_mode"] is None


async def test_someone_elses_or_trashed_note_is_not_shown(db_session: AsyncSession) -> None:
    chat = await _chat(db_session)
    bob = await make_user(db_session, "bob")
    [bobs] = (await _make_notes(db_session, bob.id, "Secret")).values()

    callback, message = _callback(chat.telegram_id, f"nv:{bobs.id}")
    await handlers.handle_note_view(callback)
    message.answer_rich.assert_not_awaited()
    assert "не найдена" in callback.answer.await_args.args[0]
