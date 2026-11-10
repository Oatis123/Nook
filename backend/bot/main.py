import asyncio
from collections.abc import Awaitable, Callable
from typing import Any
from weakref import WeakValueDictionary

import structlog
from aiogram import Bot, Dispatcher
from aiogram.types import BotCommand, TelegramObject, Update
from pydantic import ValidationError

from app.core.config import get_settings
from app.core.heartbeat import BOT_HEARTBEAT, beat
from bot.handlers import handle_widget_query, router
from bot.widget_api import WidgetQuery

settings = get_settings()
log = structlog.get_logger()

dp = Dispatcher()
dp.include_router(router)
_user_locks: WeakValueDictionary[int, asyncio.Lock] = WeakValueDictionary()


async def _dispatch_widget_updates(
    handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
    event: TelegramObject,
    data: dict[str, Any],
) -> Any:
    assert isinstance(event, Update)
    # aiogram 3.31 preserves unknown fields, but can't resolve their event type.
    query = None
    if (raw := (event.model_extra or {}).get("widget_query")) is not None:
        try:
            query = WidgetQuery.model_validate(raw)
        except ValidationError:
            log.warning("bot.invalid_widget_query", update_id=event.update_id)
            return None

    sender = data.get("event_from_user") if query is None else query.sender
    if sender is None:
        return await handler(event, data)
    # Text, legacy callbacks, and widget actions share one draft per Telegram user.
    lock = _user_locks.get(sender.id)
    if lock is None:
        lock = asyncio.Lock()
        _user_locks[sender.id] = lock
    async with lock:
        if query is not None:
            return await handle_widget_query(data["bot"], query)
        return await handler(event, data)


dp.update.outer_middleware.register(_dispatch_widget_updates)


HEARTBEAT_SECONDS = 30

COMMANDS_MENU = [
    BotCommand(command="new", description="Новая задача"),
    BotCommand(command="week", description="Задачи на неделю"),
    BotCommand(command="idea", description="Записать идею"),
    BotCommand(command="daily", description="Запись в дневник"),
    BotCommand(command="note", description="Найти и прочитать заметку"),
    BotCommand(command="cancel", description="Отменить создание задачи"),
    BotCommand(command="lists", description="Посмотреть задачи по спискам"),
    BotCommand(command="help", description="Справка"),
    BotCommand(command="unlink", description="Отвязать Telegram"),
]


async def _set_commands_menu(bot: Bot) -> None:
    """Fills Telegram's "Menu" button with the bot's commands. Best effort: a failure
    (Telegram unreachable for a moment) mustn't keep the bot from starting."""
    try:
        await bot.set_my_commands(COMMANDS_MENU, request_timeout=10)
    except Exception:
        log.warning("bot.set_commands_failed")


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
        await _set_commands_menu(bot)
        allowed_updates = [*dp.resolve_used_update_types(), "widget_query"]
        await dp.start_polling(bot, allowed_updates=allowed_updates)
    finally:
        heartbeat.cancel()


if __name__ == "__main__":
    asyncio.run(main())
