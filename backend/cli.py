import argparse
import asyncio
import getpass

from app.core.db import async_session_factory
from app.core.validation import ValidationError
from app.services.admin import create_admin


async def _create_admin_interactive(username: str, password: str) -> None:
    async with async_session_factory() as session:
        user = await create_admin(session, username, password)
        print(f"Admin user '{user.username}' created")


def main() -> None:
    parser = argparse.ArgumentParser(prog="cli.py")
    subparsers = parser.add_subparsers(dest="command", required=True)

    create_admin_parser = subparsers.add_parser("create-admin", help="Create an admin user")
    create_admin_parser.add_argument("--username", help="Admin username (a-z0-9_, 3-32 chars)")

    args = parser.parse_args()

    if args.command == "create-admin":
        username = args.username or input("Username: ")
        password = getpass.getpass("Password: ")
        password_confirm = getpass.getpass("Confirm password: ")
        if password != password_confirm:
            raise SystemExit("Passwords do not match")
        try:
            asyncio.run(_create_admin_interactive(username, password))
        except ValidationError as exc:
            raise SystemExit(str(exc)) from exc


if __name__ == "__main__":
    main()
