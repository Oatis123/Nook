from datetime import date, datetime

from freezegun import freeze_time
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.folder import Folder
from app.models.note import Note
from app.models.user import User
from app.services import daily as daily_service
from app.services import notes as notes_service
from bot import handlers
from tests.conftest import make_user
from tests.test_bot_new_task import NOW, _bot_uses_test_db, _chat, _tasks  # noqa: F401

MORNING = datetime(2026, 10, 5, 9, 7, 30)
EVENING = datetime(2026, 10, 5, 21, 40)
NEXT_DAY = datetime(2026, 10, 6, 8, 0)


async def _daily_notes(db_session: AsyncSession) -> dict[str, str]:
    """Title -> content of the notes in the Дневник folder, as the bot left them."""
    db_session.expire_all()
    rows = await db_session.execute(
        select(Note.title, Note.content)
        .join(Folder, Note.folder_id == Folder.id)
        .where(Folder.name == daily_service.DAILY_FOLDER_NAME, Note.deleted_at.is_(None))
    )
    return {title: content for title, content in rows}


async def test_entries_go_to_the_days_note_in_the_daily_folder(db_session: AsyncSession) -> None:
    user = await make_user(db_session, "alice")

    note, _ = await daily_service.append_entry(db_session, user.id, "Проснулся", MORNING)
    await daily_service.append_entry(db_session, user.id, "Вечер  \nв две строки", EVENING)
    await daily_service.append_entry(db_session, user.id, "Новый день", NEXT_DAY)

    folders = list(await db_session.scalars(select(Folder).where(Folder.user_id == user.id)))
    assert [(f.name, f.parent_id) for f in folders] == [("Дневник", None)]
    assert note.folder_id == folders[0].id
    assert await _daily_notes(db_session) == {
        "2026-10-05": "**09:07**  \nПроснулся\n\n**21:40**  \nВечер  \nв две строки\n",
        "2026-10-06": "**08:00**  \nНовый день\n",
    }


async def test_remove_entry_takes_out_just_that_entry(db_session: AsyncSession) -> None:
    user = await make_user(db_session, "alice")
    await daily_service.append_entry(db_session, user.id, "Раз", MORNING)
    _, middle = await daily_service.append_entry(db_session, user.id, "Два", EVENING)
    await daily_service.append_entry(db_session, user.id, "Три", EVENING.replace(hour=22))

    assert await daily_service.remove_entry(db_session, user.id, MORNING.date(), middle) is True
    assert await daily_service.remove_entry(db_session, user.id, MORNING.date(), middle) is False
    assert await daily_service.remove_entry(db_session, user.id, date(2030, 1, 1), middle) is False

    assert await _daily_notes(db_session) == {
        "2026-10-05": "**09:07**  \nРаз\n\n**22:40**  \nТри\n"
    }


async def test_existing_folder_and_deleted_notes_are_handled(db_session: AsyncSession) -> None:
    user = await make_user(db_session, "alice")
    first, _ = await daily_service.append_entry(db_session, user.id, "Раз", MORNING)
    await notes_service.soft_delete_note(db_session, user.id, first.id)

    second, _ = await daily_service.append_entry(db_session, user.id, "Два", EVENING)

    assert second.id != first.id
    folders = list(await db_session.scalars(select(Folder).where(Folder.user_id == user.id)))
    assert len(folders) == 1
    assert await _daily_notes(db_session) == {"2026-10-05": "**21:40**  \nДва\n"}


async def test_other_users_have_their_own_daily_notes(db_session: AsyncSession) -> None:
    alice = await make_user(db_session, "alice")
    bob = await make_user(db_session, "bob")

    await daily_service.append_entry(db_session, alice.id, "Алиса", MORNING)
    await daily_service.append_entry(db_session, bob.id, "Боб", MORNING)

    for user, text in ((alice, "Алиса"), (bob, "Боб")):
        note = await daily_service.get_daily_note(db_session, user.id, MORNING.date())
        assert note is not None and note.content == f"**09:07**  \n{text}\n"


# --- the bot ---


@freeze_time(NOW)
async def test_daily_command_with_text_appends_to_todays_note(db_session: AsyncSession) -> None:
    chat = await _chat(db_session)

    await chat.command("daily", "Первая")
    await chat.command("daily", "Вторая")

    assert await _daily_notes(db_session) == {
        "2026-10-02": "**10:00**  \nПервая\n\n**10:00**  \nВторая\n"
    }
    assert chat.last.text == "📓 Записал в дневник (пт, 2 окт 2026):\nВторая"
    assert chat.buttons() == ["Отменить"]


@freeze_time(NOW)
async def test_daily_command_alone_takes_the_next_message(db_session: AsyncSession) -> None:
    chat = await _chat(db_session)

    await chat.command("daily")
    prompt = chat.last
    assert prompt.text.startswith("📓 Напишите запись")
    await chat.type("Хороший день")

    assert await _daily_notes(db_session) == {"2026-10-02": "**10:00**  \nХороший день\n"}
    assert await _tasks(db_session) == []
    assert prompt.reply_markup is None
    assert handlers._drafts == {}
    await chat.type("Обычная задача")
    assert handlers._drafts[chat.telegram_id].step == "description"


@freeze_time(NOW)
async def test_daily_command_can_be_cancelled(db_session: AsyncSession) -> None:
    chat = await _chat(db_session)

    await chat.command("daily")
    await chat.tap("Отмена")

    assert chat.last.text == "Отменено."
    assert await _daily_notes(db_session) == {}
    assert handlers._drafts == {}


@freeze_time(NOW)
async def test_daily_button_instead_of_a_description(db_session: AsyncSession) -> None:
    chat = await _chat(db_session)

    await chat.type("Был на прогулке")
    await chat.tap("📓 В дневник")

    assert await _tasks(db_session) == []
    assert await _daily_notes(db_session) == {"2026-10-02": "**10:00**  \nБыл на прогулке\n"}
    assert chat.last.text == "📓 Записал в дневник (пт, 2 окт 2026):\nБыл на прогулке"
    assert handlers._drafts == {}


@freeze_time(NOW)
async def test_daily_undo_removes_just_that_entry(db_session: AsyncSession) -> None:
    chat = await _chat(db_session)
    await chat.command("daily", "Оставить")
    await chat.command("daily", "Убрать")

    await chat.tap("Отменить")

    assert chat.last.text == "Запись удалена."
    assert await _daily_notes(db_session) == {"2026-10-02": "**10:00**  \nОставить\n"}


@freeze_time(NOW)
async def test_daily_uses_the_users_timezone(db_session: AsyncSession) -> None:
    chat = await _chat(db_session)
    user = await db_session.scalar(select(User))
    assert user is not None
    user.timezone = "Asia/Tokyo"  # 19:00 on the 2nd
    await db_session.commit()

    await chat.command("daily", "Вечер")

    assert await _daily_notes(db_session) == {"2026-10-02": "**19:00**  \nВечер\n"}
