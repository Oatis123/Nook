from datetime import date, datetime, time

from app.services.quick_add import default_recurrence_start_date, parse_quick_add

NOW = datetime(2026, 9, 17, 8, 0)  # a Thursday


def test_extracts_priority_and_list_leaving_the_rest_as_title() -> None:
    result = parse_quick_add("Call mom !high #Personal", now=NOW)
    assert result.priority == "high"
    assert result.list_name == "Personal"
    assert result.title == "Call mom"


def test_parses_date_and_time() -> None:
    result = parse_quick_add("Call mom tomorrow 18:00 !high #Personal", now=NOW)
    assert result.due_date == date(2026, 9, 18)
    assert result.due_time == time(18, 0)
    assert result.priority == "high"
    assert result.list_name == "Personal"
    assert result.title == "Call mom"


def test_leaves_due_time_none_when_only_a_date_is_given() -> None:
    result = parse_quick_add("Pay rent tomorrow", now=NOW)
    assert result.due_date == date(2026, 9, 18)
    assert result.due_time is None


def test_returns_none_for_plain_text_with_no_recognizable_tokens() -> None:
    result = parse_quick_add("Buy milk", now=NOW)
    assert result.due_date is None
    assert result.due_time is None
    assert result.priority is None
    assert result.list_name is None
    assert result.recurrence is None
    assert result.title == "Buy milk"


def test_is_case_insensitive_for_priority() -> None:
    assert parse_quick_add("Task !LOW", now=NOW).priority == "low"


def test_parses_russian_date_and_time() -> None:
    result = parse_quick_add("купить молоко завтра в 18:00", now=NOW)
    assert result.due_date == date(2026, 9, 18)
    assert result.due_time == time(18, 0)
    assert "молоко" in result.title


def test_every_n_days_recurrence() -> None:
    result = parse_quick_add("water the plants every 3 days", now=NOW)
    assert result.recurrence is not None
    assert result.recurrence.freq == "daily"
    assert result.recurrence.interval == 3
    assert result.title == "water the plants"


def test_every_weekday_list_recurrence() -> None:
    result = parse_quick_add("standup every monday and wednesday 9am", now=NOW)
    assert result.recurrence is not None
    assert result.recurrence.freq == "weekly"
    assert result.recurrence.by_weekday == [0, 2]
    assert result.due_time == time(9, 0)
    assert result.title == "standup"


def test_daily_word_recurrence() -> None:
    result = parse_quick_add("daily standup 9am", now=NOW)
    assert result.recurrence is not None
    assert result.recurrence.freq == "daily"
    assert result.recurrence.interval == 1


def test_default_recurrence_start_date_picks_next_matching_weekday() -> None:
    # NOW is Thursday 2026-09-17; by_weekday=[0] is Monday -> next Monday is 2026-09-21.
    from app.services.recurrence import RecurrenceInput

    recurrence = RecurrenceInput(freq="weekly", by_weekday=[0])
    assert default_recurrence_start_date(recurrence, NOW.date()) == date(2026, 9, 21)


def test_default_recurrence_start_date_falls_back_to_today() -> None:
    from app.services.recurrence import RecurrenceInput

    recurrence = RecurrenceInput(freq="daily", interval=2)
    assert default_recurrence_start_date(recurrence, NOW.date()) == NOW.date()
