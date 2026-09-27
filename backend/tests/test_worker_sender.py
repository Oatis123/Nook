from typing import Any

import pytest
from aiogram.exceptions import TelegramNetworkError
from aiogram.methods import SendMessage

from worker import main as worker_main


class _FlakyBot:
    """Stands in for aiogram's Bot: the first `hangs` send_message calls fail the way a
    connection hung by network filtering does (TelegramNetworkError after the timeout)."""

    def __init__(self, hangs: int) -> None:
        self.hangs = hangs
        self.calls: list[dict[str, Any]] = []

    async def send_message(self, chat_id: int, text: str, **kwargs: Any) -> None:
        self.calls.append({"chat_id": chat_id, "text": text, **kwargs})
        if self.hangs > 0:
            self.hangs -= 1
            raise TelegramNetworkError(
                method=SendMessage(chat_id=chat_id, text=text), message="Request timeout error"
            )


async def test_hung_send_is_retried_with_short_timeout() -> None:
    bot = _FlakyBot(hangs=worker_main.SEND_ATTEMPTS - 1)
    send = worker_main._make_sender(bot)  # type: ignore[arg-type]

    await send(12345, "Now: Call back", "http://nook.local/tasks/list/1")

    assert len(bot.calls) == worker_main.SEND_ATTEMPTS
    assert all(c["request_timeout"] == worker_main.SEND_TIMEOUT_SECONDS for c in bot.calls)
    assert bot.calls[-1]["reply_markup"] is not None


async def test_send_gives_up_after_attempts_so_dispatch_backoff_takes_over() -> None:
    bot = _FlakyBot(hangs=99)
    send = worker_main._make_sender(bot)  # type: ignore[arg-type]

    with pytest.raises(TelegramNetworkError):
        await send(12345, "Now: Call back", "http://nook.local/tasks/list/1")
    assert len(bot.calls) == worker_main.SEND_ATTEMPTS
