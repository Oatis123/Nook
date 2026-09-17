from datetime import date, datetime

from app.services.recurrence import (
    RecurrenceInput,
    build_rrule,
    compute_recurrence_end,
    next_occurrence,
    occurrences_between,
)


def test_build_rrule_daily() -> None:
    assert build_rrule(RecurrenceInput(freq="daily")) == "FREQ=DAILY"


def test_build_rrule_every_n_days() -> None:
    assert build_rrule(RecurrenceInput(freq="daily", interval=3)) == "FREQ=DAILY;INTERVAL=3"


def test_build_rrule_weekly_on_days() -> None:
    rule = build_rrule(RecurrenceInput(freq="weekly", by_weekday=[0, 2, 4]))
    assert rule == "FREQ=WEEKLY;BYDAY=MO,WE,FR"


def test_build_rrule_monthly_on_day() -> None:
    rule = build_rrule(RecurrenceInput(freq="monthly", by_month_day=15))
    assert rule == "FREQ=MONTHLY;BYMONTHDAY=15"


def test_build_rrule_monthly_last_day() -> None:
    rule = build_rrule(RecurrenceInput(freq="monthly", on_last_day=True))
    assert rule == "FREQ=MONTHLY;BYMONTHDAY=-1"


def test_build_rrule_yearly() -> None:
    assert build_rrule(RecurrenceInput(freq="yearly")) == "FREQ=YEARLY"


def test_build_rrule_ends_after_count() -> None:
    rule = build_rrule(RecurrenceInput(freq="daily", end_type="after_count", end_count=5))
    assert rule == "FREQ=DAILY;COUNT=5"


def test_build_rrule_ends_on_date() -> None:
    rule = build_rrule(
        RecurrenceInput(freq="daily", end_type="on_date", end_date=date(2026, 12, 31))
    )
    assert rule == "FREQ=DAILY;UNTIL=20261231T235959"


def test_next_occurrence_daily() -> None:
    dtstart = datetime(2026, 1, 1, 9, 0)
    nxt = next_occurrence("FREQ=DAILY", dtstart, dtstart)
    assert nxt == datetime(2026, 1, 2, 9, 0)


def test_next_occurrence_none_after_count_exhausted() -> None:
    dtstart = datetime(2026, 1, 1, 9, 0)
    rule = "FREQ=DAILY;COUNT=2"
    second = next_occurrence(rule, dtstart, dtstart)
    assert second == datetime(2026, 1, 2, 9, 0)
    third = next_occurrence(rule, dtstart, second)
    assert third is None


def test_compute_recurrence_end_never() -> None:
    dtstart = datetime(2026, 1, 1, 9, 0)
    assert compute_recurrence_end("FREQ=DAILY", dtstart) is None


def test_compute_recurrence_end_after_count() -> None:
    dtstart = datetime(2026, 1, 1, 9, 0)
    end = compute_recurrence_end("FREQ=DAILY;COUNT=3", dtstart)
    assert end == datetime(2026, 1, 3, 9, 0).date()


def test_occurrences_between() -> None:
    dtstart = datetime(2026, 1, 1, 9, 0)
    occs = occurrences_between(
        "FREQ=DAILY", dtstart, datetime(2026, 1, 1), datetime(2026, 1, 5, 23, 59, 59)
    )
    assert occs == [
        datetime(2026, 1, 1, 9, 0),
        datetime(2026, 1, 2, 9, 0),
        datetime(2026, 1, 3, 9, 0),
        datetime(2026, 1, 4, 9, 0),
        datetime(2026, 1, 5, 9, 0),
    ]
