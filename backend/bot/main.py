import asyncio

import structlog
from aiogram import Bot, Dispatcher
from aiogram.filters import CommandStart
from aiogram.types import Message

from app.core.config import get_settings

settings = get_settings()
log = structlog.get_logger()

dp = Dispatcher()


@dp.message(CommandStart())
async def handle_start(message: Message) -> None:
    """Placeholder handler. Account linking/login is added in a later stage (spec §5.2/§5.3)."""
    await message.answer(f"Welcome to {settings.app_name}. This bot is not fully set up yet.")


async def main() -> None:
    if not settings.telegram_bot_token:
        log.warning("bot.no_token", msg="TELEGRAM_BOT_TOKEN is not set, bot will not start")
        while True:
            await asyncio.sleep(3600)

    bot = Bot(token=settings.telegram_bot_token)
    log.info("bot.startup", mode=settings.bot_mode)
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
