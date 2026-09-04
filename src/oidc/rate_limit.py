"""Simple in-memory sliding-window rate limiter for login POSTs."""

from __future__ import annotations

import time
from collections import defaultdict, deque


class SlidingWindowRateLimiter:
    """Per-key request limiter.

    Cloud Run caveat: this process-local store does not share state across
    instances, so the effective limit is per container, not global.
    """

    def __init__(self, *, limit: int, window_seconds: float) -> None:
        self._limit = limit
        self._window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str) -> bool:
        """Return True if ``key`` is under the limit; record the hit when allowed."""
        now = time.monotonic()
        bucket = self._hits[key]
        cutoff = now - self._window
        while bucket and bucket[0] <= cutoff:
            bucket.popleft()
        if len(bucket) >= self._limit:
            return False
        bucket.append(now)
        return True
