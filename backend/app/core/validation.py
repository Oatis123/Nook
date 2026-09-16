import re

USERNAME_RE = re.compile(r"^[a-z0-9_]{3,32}$")
MIN_PASSWORD_LENGTH = 10


class ValidationError(ValueError):
    pass


def validate_username(username: str) -> str:
    if not USERNAME_RE.match(username):
        raise ValidationError(
            "Username must be 3-32 characters, lowercase letters, digits or underscore only"
        )
    return username


def validate_password(password: str) -> str:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise ValidationError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters")
    return password
