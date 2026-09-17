import re
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

import dateparser
from dateparser.search import search_dates

from app.services.recurrence import RecurrenceInput

# Shared by the bot and (should quick-add parsing ever move server-side) the API — spec
# §9 asks for this to be one backend module rather than duplicated per caller. The web
# quick-add UI parses client-side (chrono-node, frontend/src/features/tasks/quickAddParser.ts)
# and this mirrors its priority/list/recurrence rules as closely as a Python regex can, so
# a phrase behaves the same whether typed into the web app or the bot.

_PRIORITY_RE = re.compile(r"(?:^|\s)!(low|medium|high)\b", re.IGNORECASE)
_LIST_RE = re.compile(r"(?:^|\s)#(\S+)")

_FREQ_UNIT = {
    "day": "daily",
    "days": "daily",
    "week": "weekly",
    "weeks": "weekly",
    "month": "monthly",
    "months": "monthly",
    "year": "yearly",
    "years": "yearly",
}

_WEEKDAY_TOKEN = (
    r"monday|mon|tuesday|tues|tue|wednesday|weds|wed|thursday|thurs|thur|thu|"
    r"friday|fri|saturday|sat|sunday|sun"
)
_WEEKDAY_INDEX = {
    "monday": 0,
    "mon": 0,
    "tuesday": 1,
    "tues": 1,
    "tue": 1,
    "wednesday": 2,
    "weds": 2,
    "wed": 2,
    "thursday": 3,
    "thurs": 3,
    "thur": 3,
    "thu": 3,
    "friday": 4,
    "fri": 4,
    "saturday": 5,
    "sat": 5,
    "sunday": 6,
    "sun": 6,
}

# Language-agnostic markers that a matched date phrase also pins down a *time*, not just a
# day — dateparser doesn't expose per-component certainty the way chrono-node does, so this
# is a best-effort heuristic (documented limitation, see DECISIONS.md).
_TIME_INDICATOR_RE = re.compile(
    r"\d{1,2}:\d{2}|\d{1,2}\s*(am|pm)\b|\bnoon\b|\bmidnight\b|\bat\s+\d|\bв\s+\d{1,2}([:.]\d{2})?\b",
    re.IGNORECASE,
)

DEFAULT_LANGUAGES = ["en", "ru"]


def _remove_match(text: str, match: re.Match[str]) -> str:
    without = text[: match.start()] + text[match.end() :]
    return re.sub(r"\s+", " ", without).strip()


def _parse_recurrence_phrase(text: str) -> tuple[RecurrenceInput | None, str]:
    m = re.search(
        r"\bevery\s+(\d+)\s+(day|days|week|weeks|month|months|year|years)\b", text, re.IGNORECASE
    )
    if m:
        recurrence = RecurrenceInput(
            freq=_FREQ_UNIT[m.group(2).lower()], interval=int(m.group(1)), end_type="never"
        )
        return recurrence, _remove_match(text, m)

    m = re.search(r"\bevery\s+weekday\b", text, re.IGNORECASE)
    if m:
        recurrence = RecurrenceInput(
            freq="weekly", interval=1, by_weekday=[0, 1, 2, 3, 4], end_type="never"
        )
        return recurrence, _remove_match(text, m)

    m = re.search(
        rf"\bevery\s+((?:{_WEEKDAY_TOKEN})(?:\s*(?:,|and)\s*(?:{_WEEKDAY_TOKEN}))*)\b",
        text,
        re.IGNORECASE,
    )
    if m:
        days = sorted(
            {
                _WEEKDAY_INDEX[w.lower()]
                for w in re.findall(rf"\b(?:{_WEEKDAY_TOKEN})\b", m.group(1), re.IGNORECASE)
            }
        )
        if days:
            recurrence = RecurrenceInput(
                freq="weekly", interval=1, by_weekday=days, end_type="never"
            )
            return recurrence, _remove_match(text, m)

    m = re.search(r"\bevery\s+(day|week|month|year)\b", text, re.IGNORECASE)
    if m:
        recurrence = RecurrenceInput(
            freq=_FREQ_UNIT[m.group(1).lower()], interval=1, end_type="never"
        )
        return recurrence, _remove_match(text, m)

    m = re.search(r"\b(daily|weekly|monthly|yearly|annually)\b", text, re.IGNORECASE)
    if m:
        word = m.group(1).lower()
        freq = "yearly" if word == "annually" else word
        recurrence = RecurrenceInput(freq=freq, interval=1, end_type="never")
        return recurrence, _remove_match(text, m)

    return None, text


def default_recurrence_start_date(recurrence: RecurrenceInput, today: date) -> date:
    """A recurring task needs a first-occurrence date (spec §7.4); when the phrase didn't
    pin one down itself (e.g. a bare "every monday"), pick the next matching weekday for a
    weekly-by-weekday rule, or today for anything else."""
    if recurrence.freq == "weekly" and recurrence.by_weekday:
        iso_today = today.weekday()  # Monday=0 .. Sunday=6, matches by_weekday's convention
        sorted_days = sorted(recurrence.by_weekday)
        next_day = next((d for d in sorted_days if d >= iso_today), sorted_days[0] + 7)
        return today + timedelta(days=next_day - iso_today)
    return today


@dataclass
class ParsedQuickAdd:
    title: str
    due_date: date | None
    due_time: time | None
    priority: str | None
    list_name: str | None
    recurrence: RecurrenceInput | None


def parse_quick_add(
    raw: str, *, now: datetime, languages: list[str] | None = None
) -> ParsedQuickAdd:
    """`raw` is parsed against `now` (the user's own local wall-clock time, naive — the
    caller is responsible for resolving it from the user's timezone). Mirrors
    frontend/src/features/tasks/quickAddParser.ts's priority/list/recurrence rules; dates
    use dateparser (English + Russian) instead of chrono-node."""
    text = raw
    languages = languages or DEFAULT_LANGUAGES

    priority: str | None = None
    m = _PRIORITY_RE.search(text)
    if m:
        priority = m.group(1).lower()
        text = _remove_match(text, m)

    list_name: str | None = None
    m = _LIST_RE.search(text)
    if m:
        list_name = m.group(1)
        text = _remove_match(text, m)

    recurrence, text = _parse_recurrence_phrase(text)

    due_date: date | None = None
    due_time: time | None = None
    settings = {
        "RELATIVE_BASE": now,
        "PREFER_DATES_FROM": "future",
        "RETURN_AS_TIMEZONE_AWARE": False,
    }
    found = search_dates(text, languages=languages, settings=settings)
    if found:
        matched_text, _ = found[0]
        # search_dates' own returned datetime is unreliable for bare time-only phrases
        # (e.g. "9am" alone can come back a full year off) — re-parsing just the matched
        # substring through the single-result parser is consistently correct.
        parsed_dt = dateparser.parse(matched_text, languages=languages, settings=settings)
        if parsed_dt is not None:
            due_date = parsed_dt.date()
            if _TIME_INDICATOR_RE.search(matched_text):
                due_time = parsed_dt.time()
            match_pos = text.find(matched_text)
            if match_pos != -1:
                text = (text[:match_pos] + text[match_pos + len(matched_text) :]).strip()

    title = re.sub(r"\s+", " ", text).strip()
    return ParsedQuickAdd(
        title=title,
        due_date=due_date,
        due_time=due_time,
        priority=priority,
        list_name=list_name,
        recurrence=recurrence,
    )
