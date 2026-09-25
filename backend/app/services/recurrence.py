from datetime import date, datetime, time, timedelta
from itertools import islice
from typing import Literal

from dateutil.rrule import rrulestr
from pydantic import BaseModel, Field, field_validator

# Hard caps on RRULE expansion. Expanding a rule is synchronous CPU work on the API's
# event loop, so an unbounded COUNT/UNTIL/range (COUNT=10^9, a 9999-year calendar) used
# to stall every request for seconds and eat memory. The input limits below keep new
# rules small; these caps also bound rules stored before the limits existed.
MAX_RECURRENCE_COUNT = 1000
MAX_RECURRENCE_END_YEARS = 10
MAX_EXPANDED_OCCURRENCES = 5000

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
    end_count: int | None = Field(default=None, ge=1, le=MAX_RECURRENCE_COUNT)

    @field_validator("end_date")
    @classmethod
    def _end_date_not_too_far(cls, value: date | None) -> date | None:
        if value is not None and value > date.today() + timedelta(
            days=365 * MAX_RECURRENCE_END_YEARS
        ):
            raise ValueError(f"end_date must be within {MAX_RECURRENCE_END_YEARS} years from today")
        return value


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
    occurrences = list(islice(rule, MAX_EXPANDED_OCCURRENCES))
    return occurrences[-1].date() if occurrences else dtstart.date()


def next_occurrence(rrule_string: str, dtstart: datetime, after: datetime) -> datetime | None:
    rule = rrulestr(rrule_string, dtstart=dtstart)
    return rule.after(after, inc=False)


def occurrences_between(
    rrule_string: str,
    dtstart: datetime,
    start: datetime,
    end: datetime,
    limit: int = MAX_EXPANDED_OCCURRENCES,
) -> list[datetime]:
    """Occurrences in [start, end], at most `limit` of them (generated lazily, so a huge
    range stops at the cap instead of materializing everything first)."""
    rule = rrulestr(rrule_string, dtstart=dtstart)
    result: list[datetime] = []
    for occurrence in rule.xafter(start, inc=True):
        if occurrence > end or len(result) >= limit:
            break
        result.append(occurrence)
    return result
