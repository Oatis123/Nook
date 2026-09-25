import pytest
from pydantic import ValidationError

from app.core.config import DEFAULT_SECRET_KEY, Settings

STRONG_KEY = "a" * 64


def _settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "environment": "production",
        "secret_key": STRONG_KEY,
        "postgres_user": "nook",
        "postgres_password": "s3cret",
        "postgres_db": "nook",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)  # type: ignore[arg-type]


def test_production_accepts_strong_secret_key() -> None:
    assert _settings().secret_key == STRONG_KEY


@pytest.mark.parametrize("key", [DEFAULT_SECRET_KEY, "", "short-key", "x" * 31])
def test_production_rejects_default_or_short_secret_key(key: str) -> None:
    with pytest.raises(ValidationError, match="SECRET_KEY"):
        _settings(secret_key=key)


def test_production_rejects_empty_postgres_password() -> None:
    with pytest.raises(ValidationError, match="POSTGRES_PASSWORD"):
        _settings(postgres_password="")


def test_development_keeps_default_secret_key() -> None:
    assert _settings(environment="development", secret_key=DEFAULT_SECRET_KEY)
