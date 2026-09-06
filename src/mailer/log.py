"""Log-only mailer backend (default for local / missing SMTP secrets)."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class OutgoingMail:
    """Recorded outbound message for tests and local inspection."""

    to: str
    subject: str
    body: str


@dataclass
class LogMailer:
    """Records messages in memory and logs them; never talks to a network."""

    messages: list[OutgoingMail] = field(default_factory=list)

    async def send(self, *, to: str, subject: str, body: str) -> None:
        """Append to ``messages`` and emit an info log line."""
        self.messages.append(OutgoingMail(to=to, subject=subject, body=body))
        logger.info("mailer[log] to=%s subject=%s", to, subject)
