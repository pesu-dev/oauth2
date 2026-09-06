"""Mailer protocol, factory, and fail-open helpers."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from src.config import AppConfig
    from src.repos.users import UserRepo

logger = logging.getLogger(__name__)


class Mailer(Protocol):
    """Async port for transactional email delivery."""

    async def send(self, *, to: str, subject: str, body: str) -> None:
        """Deliver one message to ``to``."""
        ...


def build_mailer(config: AppConfig) -> Mailer:
    """Select SMTP when both Gmail env secrets are set; otherwise log-only."""
    user = config.gmail_smtp_user
    password = config.gmail_smtp_app_password
    if user and password:
        from src.mailer.smtp import SmtpMailer

        return SmtpMailer(username=user, password=password)
    from src.mailer.log import LogMailer

    return LogMailer()


async def send_quietly(
    mailer: Mailer,
    *,
    to: str,
    subject: str,
    body: str,
) -> None:
    """Fire-and-forget send; never raise into the caller."""
    try:
        await mailer.send(to=to, subject=subject, body=body)
    except Exception:
        logger.exception("mailer send failed to=%s subject=%s", to, subject)


async def notify_sub_quietly(
    mailer: Mailer,
    users: UserRepo,
    *,
    sub: str,
    subject: str,
    body: str,
) -> None:
    """Resolve ``sub`` email and send quietly; skip if missing email."""
    try:
        user = await users.get_user(sub)
    except Exception:
        logger.exception("mailer notify: failed to load user sub=%s", sub)
        return
    if user is None or not user.email:
        return
    await send_quietly(mailer, to=user.email, subject=subject, body=body)
