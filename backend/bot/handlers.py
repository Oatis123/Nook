import uuid

import structlog
from aiogram import F, Router
from aiogram.filters import Command, CommandObject, CommandStart
from aiogram.types import (
    CallbackQuery,
    InaccessibleMessage,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
)

from app.core.config import get_settings
from app.core.db import async_session_factory
from app.services import admin as admin_service
from app.services import telegram_link as telegram_link_service

router = Router()
settings = get_settings()
log = structlog.get_logger()

NOT_LINKED_TEXT = (
    "This bot works only with a linked account.\n"
    f"Open {settings.public_url} and connect Telegram from Settings first."
)


@router.message(CommandStart(deep_link=True))
async def handle_start_deep_link(message: Message, command: CommandObject) -> None:
    if message.from_user is None:
        return
    payload = command.args or ""
    if payload.startswith("link_"):
        await _handle_link(message, message.from_user.id, payload.removeprefix("link_"))
    elif payload.startswith("login_"):
        await _handle_login(message, message.from_user.id, payload.removeprefix("login_"))
    else:
        await message.answer(f"Welcome to {settings.app_name}.\n\n{NOT_LINKED_TEXT}")


@router.message(CommandStart())
async def handle_start_plain(message: Message) -> None:
    if message.from_user is None:
        return
    async with async_session_factory() as session:
        user = await telegram_link_service.get_user_by_telegram_id(session, message.from_user.id)
    if user is None:
        await message.answer(f"Welcome to {settings.app_name}.\n\n{NOT_LINKED_TEXT}")
    else:
        await message.answer(f"Welcome back, {user.username}.")


async def _handle_link(message: Message, telegram_user_id: int, plain_token: str) -> None:
    async with async_session_factory() as session:
        user = await telegram_link_service.consume_link_token(
            session, plain_token, telegram_user_id, message.chat.id
        )
    if user is None:
        await message.answer(
            "This link is invalid, expired, or this Telegram account is already linked "
            "to a different account."
        )
        return
    log.info("bot.telegram_linked", user_id=str(user.id))
    await message.answer(
        f"Your Telegram is now linked to {settings.app_name} as '{user.username}'."
    )


async def _handle_login(message: Message, telegram_user_id: int, plain_token: str) -> None:
    async with async_session_factory() as session:
        user = await telegram_link_service.get_user_by_telegram_id(session, telegram_user_id)
        if user is None:
            await message.answer(NOT_LINKED_TEXT)
            return

        token = await telegram_link_service.find_login_token_by_plain(session, plain_token)
        if token is None or token.used_at is not None:
            await message.answer("This login link is invalid or has expired.")
            return

        await telegram_link_service.attach_login_requester(session, token, user.id)
        meta = token.meta or {}
        token_id = token.id

    device = meta.get("user_agent") or "an unknown device"
    ip = meta.get("ip") or "an unknown location"
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="Confirm login", callback_data=f"tglogin:confirm:{token_id}"
                ),
                InlineKeyboardButton(text="Deny", callback_data=f"tglogin:deny:{token_id}"),
            ]
        ]
    )
    await message.answer(
        f"Someone is trying to log in to {settings.app_name} as '{user.username}' from:\n"
        f"{device}\n{ip}\n\nConfirm it's you?",
        reply_markup=keyboard,
    )


@router.callback_query(F.data.startswith("tglogin:"))
async def handle_login_callback(callback: CallbackQuery) -> None:
    if (
        callback.data is None
        or callback.message is None
        or isinstance(callback.message, InaccessibleMessage)
        or callback.from_user is None
    ):
        return
    _, action, token_id_raw = callback.data.split(":", 2)
    try:
        token_id = uuid.UUID(token_id_raw)
    except ValueError:
        await callback.answer("This request is no longer valid.", show_alert=True)
        return

    async with async_session_factory() as session:
        token = await telegram_link_service.find_login_token_by_id(session, token_id)
        if token is None or token.user_id is None:
            await callback.answer("This request is no longer valid.", show_alert=True)
            return

        user = await telegram_link_service.get_user_by_telegram_id(session, callback.from_user.id)
        if user is None or user.id != token.user_id:
            await callback.answer("This isn't your login request.", show_alert=True)
            return

        await telegram_link_service.set_login_status(
            session, token, "confirmed" if action == "confirm" else "denied"
        )
        log.info("bot.telegram_login_answered", user_id=str(user.id), action=action)

    text = (
        "Login confirmed. You can return to the browser."
        if action == "confirm"
        else "Login denied."
    )
    await callback.message.edit_text(text)
    await callback.answer()


@router.message(Command("help"))
async def handle_help(message: Message) -> None:
    await message.answer(
        f"{settings.app_name} bot commands:\n\n"
        "/help — this message\n"
        "/unlink — disconnect your Telegram from your account\n\n"
        "Task creation from chat is coming soon."
    )


@router.message(Command("unlink"))
async def handle_unlink(message: Message) -> None:
    if message.from_user is None:
        return
    async with async_session_factory() as session:
        user = await telegram_link_service.get_user_by_telegram_id(session, message.from_user.id)
    if user is None:
        await message.answer(NOT_LINKED_TEXT)
        return

    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="Yes, unlink", callback_data=f"unlink:confirm:{user.id}"),
                InlineKeyboardButton(text="Cancel", callback_data="unlink:cancel"),
            ]
        ]
    )
    await message.answer("Disconnect Telegram from your account?", reply_markup=keyboard)


@router.callback_query(F.data.startswith("unlink:"))
async def handle_unlink_callback(callback: CallbackQuery) -> None:
    if (
        callback.data is None
        or callback.message is None
        or isinstance(callback.message, InaccessibleMessage)
        or callback.from_user is None
    ):
        return
    if callback.data == "unlink:cancel":
        await callback.message.edit_text("Cancelled.")
        await callback.answer()
        return

    _, _, user_id = callback.data.split(":", 2)
    async with async_session_factory() as session:
        user = await telegram_link_service.get_user_by_telegram_id(session, callback.from_user.id)
        if user is None or str(user.id) != user_id:
            await callback.answer("This isn't your account.", show_alert=True)
            return
        await admin_service.unlink_telegram(session, user.id)
        log.info("bot.telegram_unlinked", user_id=str(user.id))

    await callback.message.edit_text("Telegram disconnected.")
    await callback.answer()


@router.message()
async def handle_plain_message(message: Message) -> None:
    if message.from_user is None:
        return
    async with async_session_factory() as session:
        user = await telegram_link_service.get_user_by_telegram_id(session, message.from_user.id)
    if user is None:
        await message.answer(NOT_LINKED_TEXT)
        return
    await message.answer("Creating tasks from chat is coming soon.")
