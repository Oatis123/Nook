from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Nook"
    public_url: str = "http://localhost:8080"
    secret_key: str = "dev-secret-key-change-me"

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
    web_port: int = 8080

    environment: Literal["development", "production", "test"] = "development"

    attachments_dir: str = "/data/attachments"

    access_token_ttl_minutes: int = 15
    refresh_token_ttl_days: int = 30
    telegram_link_token_ttl_minutes: int = 10
    invite_default_ttl_days: int = 7

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+asyncpg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
