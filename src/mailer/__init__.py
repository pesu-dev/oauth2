"""Transactional email port (log or Gmail SMTP)."""

from __future__ import annotations

from src.mailer.log import LogMailer
from src.mailer.port import Mailer, build_mailer, notify_sub_quietly, send_quietly
from src.mailer.smtp import SmtpMailer

__all__ = [
    "LogMailer",
    "Mailer",
    "SmtpMailer",
    "build_mailer",
    "notify_sub_quietly",
    "send_quietly",
]
