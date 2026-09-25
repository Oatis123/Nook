import asyncio
import contextlib
import signal

import structlog
from aiogram import Bot
from aiogram.exceptions import TelegramForbiddenError
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

from app.core.config import get_settings
from app.core.db import async_session_factory
from app.core.heartbeat import WORKER_HEARTBEAT, beat
from app.services.reminder_dispatch import ReminderBlocked, dispatch_due_reminders
from app.services.reminders import purge_resolved_reminders
from app.services.telegram_link import purge_expired_tokens
from app.services.vault_import import (
    fail_interrupted_import_jobs,
    process_pending_import_jobs,
)

settings = get_settings()
log = structlog.get_logger()

TICK_SECONDS = 30
IMPORT_POLL_SECONDS = 5
MAINTENANCE_SECONDS = 3600
# After an unexpected error, back off a little so a persistent failure (DB down) doesn't
# spin or flood the logs.
ERROR_BACKOFF_SECONDS = 10

# Set on SIGTERM/SIGINT: each loop finishes its current iteration and exits, instead of
# being SIGKILLed mid-send by `docker stop` after the grace period.
_stop = asyncio.Event()


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


async def _sleep(seconds: float) -> None:
    with contextlib.suppress(TimeoutError):
        await asyncio.wait_for(_stop.wait(), timeout=seconds)


async def tick(bot: Bot | None) -> None:
    if bot is None:
        return
    async with async_session_factory() as session:
        count = await dispatch_due_reminders(session, _make_sender(bot))
    if count:
        log.info("worker.dispatched", count=count)


async def _reminder_loop(bot: Bot | None) -> None:
    while not _stop.is_set():
        try:
            await tick(bot)
        except Exception:
            # One bad tick (DB hiccup, Telegram outage) must not kill the process — and
            # with it the import loop running alongside.
            log.exception("worker.tick_failed")
            await _sleep(ERROR_BACKOFF_SECONDS)
        beat(WORKER_HEARTBEAT)
        await _sleep(TICK_SECONDS)


async def _import_loop() -> None:
    """A separate, faster poll than reminders (spec §6.9: import runs in the background) —
    its own asyncio task so a slow vault import never delays reminder dispatch."""
    while not _stop.is_set():
        try:
            async with async_session_factory() as session:
                count = await process_pending_import_jobs(session)
            if count:
                log.info("worker.import_jobs_processed", count=count)
        except Exception:
            log.exception("worker.import_poll_failed")
            await _sleep(ERROR_BACKOFF_SECONDS)
        await _sleep(IMPORT_POLL_SECONDS)


async def _maintenance_loop() -> None:
    while not _stop.is_set():
        try:
            async with async_session_factory() as session:
                purged = await purge_resolved_reminders(session)
                tokens = await purge_expired_tokens(session)
            if purged or tokens:
                log.info("worker.purged", reminders=purged, tokens=tokens)
        except Exception:
            log.exception("worker.maintenance_failed")
        await _sleep(MAINTENANCE_SECONDS)


async def main() -> None:
    log.info("worker.startup", app_name=settings.app_name)
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, _stop.set)

    if not settings.telegram_bot_token:
        log.warning("worker.no_token", msg="TELEGRAM_BOT_TOKEN is not set, reminders will not send")

    async with async_session_factory() as session:
        interrupted = await fail_interrupted_import_jobs(session)
    if interrupted:
        log.warning("worker.import_jobs_interrupted", count=interrupted)

    bot = Bot(token=settings.telegram_bot_token) if settings.telegram_bot_token else None
    try:
        await asyncio.gather(_reminder_loop(bot), _import_loop(), _maintenance_loop())
    finally:
        if bot is not None:
            await bot.session.close()
        log.info("worker.shutdown")


if __name__ == "__main__":
    asyncio.run(main())
