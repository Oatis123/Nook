import asyncio

import structlog
from aiogram import Bot, Dispatcher

from app.core.config import get_settings
from app.core.heartbeat import BOT_HEARTBEAT, beat
from bot.handlers import router

settings = get_settings()
log = structlog.get_logger()

dp = Dispatcher()
dp.include_router(router)


HEARTBEAT_SECONDS = 30


async def _heartbeat_loop() -> None:
    while True:
        beat(BOT_HEARTBEAT)
        await asyncio.sleep(HEARTBEAT_SECONDS)


async def main() -> None:
    heartbeat = asyncio.create_task(_heartbeat_loop())
    try:
        if not settings.telegram_bot_token:
            log.warning("bot.no_token", msg="TELEGRAM_BOT_TOKEN is not set, bot will not start")
            while True:
                await asyncio.sleep(3600)

        bot = Bot(token=settings.telegram_bot_token)
        log.info("bot.startup", mode=settings.bot_mode)
        await dp.start_polling(bot)
    finally:
        heartbeat.cancel()


if __name__ == "__main__":
    asyncio.run(main())
