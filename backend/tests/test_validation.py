import pytest

from app.core.validation import ValidationError, validate_password, validate_username


@pytest.mark.parametrize("username", ["abc", "a" * 32, "user_1", "a1_2"])
def test_validate_username_accepts_valid(username: str) -> None:
    assert validate_username(username) == username


@pytest.mark.parametrize("username", ["ab", "a" * 33, "User1", "user name", "user-1", "usér", ""])
def test_validate_username_rejects_invalid(username: str) -> None:
    with pytest.raises(ValidationError):
        validate_username(username)


def test_validate_password_accepts_valid() -> None:
    assert validate_password("a" * 10) == "a" * 10


def test_validate_password_rejects_short() -> None:
    with pytest.raises(ValidationError):
        validate_password("a" * 9)
