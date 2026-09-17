import asyncio

import structlog
from aiogram import Bot, Dispatcher

from app.core.config import get_settings
from bot.handlers import router

settings = get_settings()
log = structlog.get_logger()

dp = Dispatcher()
dp.include_router(router)


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
