from datetime import date, datetime, time
from typing import Literal

from dateutil.rrule import rrulestr
from pydantic import BaseModel, Field

_WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]


class RecurrenceInput(BaseModel):
    """Structured recurrence input — spec §7.4's listed presets (daily; weekly on chosen
    days; monthly on a day-of-month or the last day; yearly; every N days/weeks/months;
    "custom") are all expressible as freq + interval + by_weekday/by_month_day, so there's
    no separate "custom" mode: interval > 1 on any freq already covers "every N ..."."""

    freq: Literal["daily", "weekly", "monthly", "yearly"]
    interval: int = Field(default=1, ge=1, le=999)
    by_weekday: list[int] | None = None  # 0=Monday .. 6=Sunday, weekly only
    by_month_day: int | None = Field(default=None, ge=1, le=31)  # monthly only
    on_last_day: bool = False  # monthly only — last day of the month
    end_type: Literal["never", "on_date", "after_count"] = "never"
    end_date: date | None = None
    end_count: int | None = Field(default=None, ge=1)


def build_rrule(rec: RecurrenceInput) -> str:
    parts = [f"FREQ={rec.freq.upper()}"]
    if rec.interval > 1:
        parts.append(f"INTERVAL={rec.interval}")
    if rec.freq == "weekly" and rec.by_weekday:
        days = ",".join(_WEEKDAY_CODES[d] for d in sorted(set(rec.by_weekday)))
        parts.append(f"BYDAY={days}")
    if rec.freq == "monthly":
        if rec.on_last_day:
            parts.append("BYMONTHDAY=-1")
        elif rec.by_month_day:
            parts.append(f"BYMONTHDAY={rec.by_month_day}")
    if rec.end_type == "after_count" and rec.end_count:
        parts.append(f"COUNT={rec.end_count}")
    elif rec.end_type == "on_date" and rec.end_date:
        until = datetime.combine(rec.end_date, time(23, 59, 59))
        parts.append(f"UNTIL={until.strftime('%Y%m%dT%H%M%S')}")
    return ";".join(parts)


def compute_recurrence_end(rrule_string: str, dtstart: datetime) -> date | None:
    """The cached "last occurrence" date (spec's `recurrence_end` column) — precomputed
    once so "is this recurrence still active" doesn't need to re-parse/expand the RRULE
    on every read. None means it never ends (no COUNT or UNTIL)."""
    if "COUNT=" not in rrule_string and "UNTIL=" not in rrule_string:
        return None
    rule = rrulestr(rrule_string, dtstart=dtstart)
    occurrences = list(rule)
    return occurrences[-1].date() if occurrences else dtstart.date()


def next_occurrence(rrule_string: str, dtstart: datetime, after: datetime) -> datetime | None:
    rule = rrulestr(rrule_string, dtstart=dtstart)
    return rule.after(after, inc=False)


def occurrences_between(
    rrule_string: str, dtstart: datetime, start: datetime, end: datetime
) -> list[datetime]:
    rule = rrulestr(rrule_string, dtstart=dtstart)
    return list(rule.between(start, end, inc=True))
