"""Bot API 10.4 methods and update model until aiogram includes them."""

import json
import zlib
from functools import cache
from pathlib import Path
from typing import Any

import structlog
from aiogram import Bot
from aiogram.exceptions import TelegramBadRequest, TelegramNotFound
from aiogram.methods import TelegramMethod
from aiogram.types import Chat, InlineKeyboardMarkup, Message, User
from pydantic import BaseModel, Field

log = structlog.get_logger()


class SendWidget(TelegramMethod[Message]):
    __api_method__ = "sendWidget"
    __returning__ = Message

    chat_id: int
    message_thread_id: int | None = None
    html: str
    width: int = 398
    chat_data: str
    allow_queries: bool
    reply_markup: InlineKeyboardMarkup | None = None


class AnswerWidgetQuery(TelegramMethod[bool]):
    __api_method__ = "answerWidgetQuery"
    __returning__ = bool

    widget_query_id: str
    data: str | None = None


class EditMessageWidgetData(TelegramMethod[bool]):
    __api_method__ = "editMessageWidgetData"
    __returning__ = bool

    chat_id: int
    message_id: int
    chat_data: str


class WidgetQuery(BaseModel):
    id: str
    sender: User = Field(alias="from")
    chat: Chat | None = None
    message_id: int | None = None
    data: str


def encode(data: dict[str, Any]) -> str:
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    if len(payload.encode()) > 1024:
        raise ValueError("Telegram widget data exceeds 1024 bytes")
    return payload


@cache
def widget_html() -> str:
    source = Path(__file__).with_name("widget.html").read_text(encoding="utf-8")
    content = source.encode()
    if len(content) > 32768 or len(zlib.compress(content, 9)) > 4096:
        raise ValueError("Telegram widget HTML exceeds Bot API limits")
    return source


def can_send(message: Message) -> bool:
    chat = getattr(message, "chat", None)
    return isinstance(chat, Chat) and chat.type == "private" and message.bot is not None


async def send(
    message: Message,
    state: dict[str, Any],
    *,
    interactive: bool = False,
    keyboard: InlineKeyboardMarkup | None = None,
) -> Message | None:
    if not can_send(message):
        return None
    bot = message.bot
    assert bot is not None
    try:
        return await bot(
            SendWidget(
                chat_id=message.chat.id,
                message_thread_id=message.message_thread_id if message.is_topic_message else None,
                html=widget_html(),
                chat_data=encode(state),
                allow_queries=interactive,
                reply_markup=keyboard,
            )
        )
    except (TelegramBadRequest, TelegramNotFound, ValueError) as error:
        log.warning("bot.widget_send_fallback", error_type=type(error).__name__)
        return None


async def edit(bot: Bot, chat_id: int, message_id: int, state: dict[str, Any]) -> bool:
    try:
        return await bot(
            EditMessageWidgetData(chat_id=chat_id, message_id=message_id, chat_data=encode(state)),
            request_timeout=5,
        )
    except TelegramBadRequest as error:
        if "message is not modified" in error.message.lower():
            return True
        log.warning("bot.widget_edit_failed", message_id=message_id)
        return False
    except TelegramNotFound:
        log.warning("bot.widget_edit_failed", message_id=message_id)
        return False
