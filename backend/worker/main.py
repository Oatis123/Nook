import asyncio

import structlog
from aiogram import Bot
from aiogram.exceptions import TelegramForbiddenError
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

from app.core.config import get_settings
from app.core.db import async_session_factory
from app.services.reminder_dispatch import ReminderBlocked, dispatch_due_reminders

settings = get_settings()
log = structlog.get_logger()

TICK_SECONDS = 30


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


async def main() -> None:
    log.info("worker.startup", app_name=settings.app_name)
    if not settings.telegram_bot_token:
        log.warning("worker.no_token", msg="TELEGRAM_BOT_TOKEN is not set, reminders will not send")

    bot = Bot(token=settings.telegram_bot_token) if settings.telegram_bot_token else None
    try:
        while True:
            await tick(bot)
            await asyncio.sleep(TICK_SECONDS)
    finally:
        if bot is not None:
            await bot.session.close()


if __name__ == "__main__":
    asyncio.run(main())
