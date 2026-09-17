from datetime import date
from datetime import time as time_cls

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.task import TaskPriority
from app.models.task_list import TaskListColor, TaskListIcon
from app.services import task_lists as task_lists_service
from app.services.quick_add import ParsedQuickAdd
from app.services.recurrence import RecurrenceInput
from bot.handlers import _create_task_from_parsed, _describe_rrule, _summary_text
from tests.conftest import make_user


async def test_matches_list_name_case_insensitively(db_session: AsyncSession) -> None:
    user = await make_user(db_session, "alice")
    work = await task_lists_service.create_task_list(
        db_session, user.id, "Work", TaskListColor.palette_1, TaskListIcon.briefcase
    )

    parsed = ParsedQuickAdd(
        title="Ship the report",
        due_date=None,
        due_time=None,
        priority=None,
        list_name="work",
        recurrence=None,
    )
    task, list_name = await _create_task_from_parsed(db_session, user, parsed)

    assert task.list_id == work.id
    assert list_name == "Work"
    assert task.title == "Ship the report"


async def test_unmatched_list_name_is_appended_back_to_title(db_session: AsyncSession) -> None:
    user = await make_user(db_session, "alice")

    parsed = ParsedQuickAdd(
        title="Ship the report",
        due_date=None,
        due_time=None,
        priority=None,
        list_name="Nonexistent",
        recurrence=None,
    )
    task, list_name = await _create_task_from_parsed(db_session, user, parsed)

    assert list_name == "Inbox"
    assert task.title == "Ship the report #Nonexistent"


async def test_recurring_without_explicit_date_gets_default_start_date(
    db_session: AsyncSession,
) -> None:
    user = await make_user(db_session, "alice")
    parsed = ParsedQuickAdd(
        title="Standup",
        due_date=None,
        due_time=time_cls(9, 0),
        priority=None,
        list_name=None,
        recurrence=RecurrenceInput(freq="daily", interval=1),
    )
    task, _ = await _create_task_from_parsed(db_session, user, parsed)

    assert task.is_recurring is True
    assert task.due_date == date.today()
    assert task.due_time == time_cls(9, 0)


async def test_priority_is_applied(db_session: AsyncSession) -> None:
    user = await make_user(db_session, "alice")
    parsed = ParsedQuickAdd(
        title="Fix the bug",
        due_date=None,
        due_time=None,
        priority="high",
        list_name=None,
        recurrence=None,
    )
    task, _ = await _create_task_from_parsed(db_session, user, parsed)
    assert task.priority == TaskPriority.high


def test_summary_text_includes_due_priority_and_recurrence() -> None:
    class _FakeTask:
        title = "Standup"
        due_date = date(2026, 1, 2)
        due_time = None
        priority = TaskPriority.high
        is_recurring = True
        rrule = "FREQ=WEEKLY;BYDAY=MO,WE"

    text = _summary_text(_FakeTask(), "Work")  # type: ignore[arg-type]
    assert "Created: Standup" in text
    assert "List: Work" in text
    assert "Priority: High" in text
    assert "Repeats: Every week on Mon, Wed" in text


def test_describe_rrule_formats_common_shapes() -> None:
    assert _describe_rrule("FREQ=DAILY") == "Every day"
    assert _describe_rrule("FREQ=DAILY;INTERVAL=3") == "Every 3 days"
    assert _describe_rrule("FREQ=WEEKLY;BYDAY=MO,WE,FR") == "Every week on Mon, Wed, Fri"
    assert _describe_rrule("FREQ=MONTHLY;BYMONTHDAY=-1") == "Every month on the last day"
    assert _describe_rrule("FREQ=DAILY;COUNT=5") == "Every day, 5×"
