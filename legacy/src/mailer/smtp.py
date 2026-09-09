"""Gmail SMTP mailer backend (stdlib smtplib + email)."""

from __future__ import annotations

import asyncio
import logging
import smtplib
from email.message import EmailMessage

logger = logging.getLogger(__name__)

_GMAIL_SMTP_HOST = "smtp.gmail.com"
_GMAIL_SMTP_PORT = 465


class SmtpMailer:
    """Send via Gmail SMTP using an app password (not the account login password)."""

    def __init__(self, *, username: str, password: str) -> None:
        self._username = username
        self._password = password

    async def send(self, *, to: str, subject: str, body: str) -> None:
        """Build a plain-text message and deliver over SMTP_SSL in a worker thread."""
        message = EmailMessage()
        message["From"] = self._username
        message["To"] = to
        message["Subject"] = subject
        message.set_content(body)
        await asyncio.to_thread(self._send_sync, message)

    def _send_sync(self, message: EmailMessage) -> None:
        with smtplib.SMTP_SSL(_GMAIL_SMTP_HOST, _GMAIL_SMTP_PORT) as smtp:
            smtp.login(self._username, self._password)
            smtp.send_message(message)
        logger.info("mailer[smtp] to=%s subject=%s", message["To"], message["Subject"])
