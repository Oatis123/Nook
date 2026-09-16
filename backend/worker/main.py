import asyncio

import structlog

from app.core.config import get_settings

settings = get_settings()
log = structlog.get_logger()

TICK_SECONDS = 30


async def tick() -> None:
    """Placeholder tick. Reminder dispatch logic is added in a later stage (spec §8.4)."""
    log.info("worker.tick")


async def main() -> None:
    log.info("worker.startup", app_name=settings.app_name)
    while True:
        await tick()
        await asyncio.sleep(TICK_SECONDS)


if __name__ == "__main__":
    asyncio.run(main())
