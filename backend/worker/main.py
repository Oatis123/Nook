import asyncio

import structlog
from aiogram import Bot
from aiogram.exceptions import TelegramForbiddenError
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

from app.core.config import get_settings
from app.core.db import async_session_factory
from app.core.heartbeat import WORKER_HEARTBEAT, beat
from app.services.reminder_dispatch import ReminderBlocked, dispatch_due_reminders
from app.services.vault_import import process_pending_import_jobs

settings = get_settings()
log = structlog.get_logger()

TICK_SECONDS = 30
IMPORT_POLL_SECONDS = 5


def _make_sender(bot: Bot):
    async def send(chat_id: int, text: str, url: str) -> None:
        keyboard = InlineKeyboardMarkup(
            inline_keyboard=[[InlineKeyboardButton(text="Open", url=url)]]
        )
        try:
            await bot.send_message(chat_id, text, reply_markup=keyboard)
        except TelegramForbiddenError as exc:
            raise ReminderBlocked from exc

    return send


async def tick(bot: Bot | None) -> None:
    if bot is None:
        return
    async with async_session_factory() as session:
        count = await dispatch_due_reminders(session, _make_sender(bot))
    if count:
        log.info("worker.dispatched", count=count)


async def _reminder_loop(bot: Bot | None) -> None:
    while True:
        await tick(bot)
        beat(WORKER_HEARTBEAT)
        await asyncio.sleep(TICK_SECONDS)


async def _import_loop() -> None:
    """A separate, faster poll than reminders (spec §6.9: import runs in the background) —
    its own asyncio task so a slow vault import never delays reminder dispatch."""
    while True:
        async with async_session_factory() as session:
            count = await process_pending_import_jobs(session)
        if count:
            log.info("worker.import_jobs_processed", count=count)
        await asyncio.sleep(IMPORT_POLL_SECONDS)


async def main() -> None:
    log.info("worker.startup", app_name=settings.app_name)
    if not settings.telegram_bot_token:
        log.warning("worker.no_token", msg="TELEGRAM_BOT_TOKEN is not set, reminders will not send")

    bot = Bot(token=settings.telegram_bot_token) if settings.telegram_bot_token else None
    try:
        await asyncio.gather(_reminder_loop(bot), _import_loop())
    finally:
        if bot is not None:
            await bot.session.close()


if __name__ == "__main__":
    asyncio.run(main())
