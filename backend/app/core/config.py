from functools import lru_cache
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_SECRET_KEY = "dev-secret-key-change-me-0000000000"
MIN_SECRET_KEY_BYTES = 32


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Nook"
    public_url: str = "http://localhost:8080"
    secret_key: str = DEFAULT_SECRET_KEY

    postgres_user: str = "nook"
    postgres_password: str = "nook"
    postgres_db: str = "nook"
    postgres_host: str = "db"
    postgres_port: int = 5432

    telegram_bot_token: str = ""
    telegram_bot_username: str = ""
    bot_mode: Literal["polling", "webhook"] = "polling"

    admin_username: str = ""
    admin_password: str = ""

    max_upload_mb: int = 25
    max_import_mb: int = 500
    web_port: int = 8080

    environment: Literal["development", "production", "test"] = "development"

    attachments_dir: str = "/data/attachments"

    access_token_ttl_minutes: int = 15
    refresh_token_ttl_days: int = 30
    telegram_link_token_ttl_minutes: int = 10
    invite_default_ttl_days: int = 7
    password_reset_ttl_minutes: int = 60

    @model_validator(mode="after")
    def _validate_production_secrets(self) -> "Settings":
        """Refuse to start in production with a missing, default or short SECRET_KEY —
        anyone who knows the key can forge a session JWT for any user — or with empty
        Postgres credentials. Development and test keep working with the defaults."""
        if self.environment != "production":
            return self
        problems = []
        if self.secret_key == DEFAULT_SECRET_KEY:
            problems.append("SECRET_KEY is not set (still the built-in development default)")
        elif len(self.secret_key.encode()) < MIN_SECRET_KEY_BYTES:
            problems.append(
                f"SECRET_KEY must be at least {MIN_SECRET_KEY_BYTES} bytes "
                "(generate one with `openssl rand -hex 32`)"
            )
        for name in ("postgres_user", "postgres_password", "postgres_db"):
            if not getattr(self, name):
                problems.append(f"{name.upper()} must not be empty")
        if problems:
            raise ValueError("Invalid production configuration: " + "; ".join(problems))
        return self

    @property
    def imports_dir(self) -> str:
        """A subdirectory of the same shared volume attachments already use (both `api`
        and `worker` mount it) rather than a new named volume — the `_` prefix keeps it
        from ever colliding with a real user_id directory."""
        return f"{self.attachments_dir}/_imports"

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+asyncpg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def test_database_url(self) -> str:
        """A separate database from the one used for `docker compose up` / manual runs,
        so the test suite's create_all/drop_all cycles never touch real dev data."""
        return (
            f"postgresql+asyncpg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}_test"
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
