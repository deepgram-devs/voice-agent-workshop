"""Keep a conversation going when the connection drops: `run_resilient` in place of `run`.

A dropped connection on a train or a hotel network ends `run` for good. This one
reconnects with a growing wait (1 s, 2 s, 4 s ... up to 15 s, with a little jitter)
and sends your Settings again on every new connection, because the agent knows
nothing until Settings arrive. Each close code it sees is printed, so you can tell
a network drop (1006) from a server problem (1011) or a restart (1012).

It tries again only when trying again can help:

    reconnects    no close frame (1006), server error (1011), restart (1012),
                  try again later (1013), bad gateway (1014), a network error,
                  HTTP 429 or 5xx on connect
    stops         you hung up (agent.close()), a clean close (1000), any other close,
                  a refused key or token (401), a closed workshop proxy (404), or a
                  workshop stop code (TALK_UNCONFIGURED, TALK_PAUSED, ONLINE_FULL,
                  LIVE_CLOSED, TOKEN_*, SESSION_REPLACED ...)

A reconnect starts a new conversation: the agent doesn't remember the old one.

    from agent.resilient import run_resilient
    run_resilient(build_settings, on_event)        # instead of run(build_settings, on_event)
"""

from __future__ import annotations

import asyncio
import random
import sys
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional

from agent.common import PROJECT_ROOT, Agent, BuildSettings, OnEvent, SetupError, credentials_note, exit_status, load_env, mission_of, print_crash, run_async

RETRY_CLOSE_CODES = {1006, 1011, 1012, 1013, 1014}
MAX_ATTEMPTS = 5
BASE_DELAY_S = 1.0
MAX_DELAY_S = 15.0


def backoff(attempt: int, base: float = BASE_DELAY_S, cap: float = MAX_DELAY_S) -> float:
    """Seconds to wait before attempt `attempt + 1`: doubles each time, capped, plus up to 25% jitter."""
    delay = min(cap, base * (2 ** (attempt - 1)))
    return delay + random.uniform(0, delay / 4)


def should_reconnect(agent: Agent) -> bool:
    """True when the call ended in a way a new connection can fix."""
    return not agent.hung_up and agent.stop_code is None and agent.close_code in RETRY_CLOSE_CODES


async def run_resilient_async(
    build_settings: BuildSettings,
    on_event: Optional[OnEvent] = None,
    *,
    max_attempts: int = MAX_ATTEMPTS,
    sleep: Callable[[float], Awaitable[Any]] = asyncio.sleep,
    log: Callable[[str], None] = print,
    **run_options: Any,
) -> Agent:
    """run_async with reconnects. Returns the last conversation's Agent. Takes
    run_async's options (url, api_key, save_audio, mic, quiet, mission ...)."""
    attempt = 1
    while True:
        try:
            agent = await run_async(build_settings, on_event, **run_options)
        except SetupError as err:
            if not err.retryable or attempt >= max_attempts:
                raise
            wait = backoff(attempt)
            log(f"[reconnect] {err} Trying again in {wait:.1f} s (attempt {attempt + 1} of {max_attempts}).")
        else:
            if not should_reconnect(agent):
                return agent
            closed = f"{agent.close_code} {agent.close_reason}".strip()
            if attempt >= max_attempts:
                log(f"[reconnect] closed {closed}; giving up after {attempt} attempts.")
                return agent
            wait = backoff(attempt)
            log(f"[reconnect] closed {closed}; trying again in {wait:.1f} s (attempt {attempt + 1} of {max_attempts}).")
        await sleep(wait)
        attempt += 1


def run_resilient(build_settings: BuildSettings, on_event: Optional[OnEvent] = None) -> None:
    """Entry point like common.run: `uv run python missions/NN-name/start.py`, with reconnects."""
    save: Optional[Path] = PROJECT_ROOT / "out" / "last-call.wav"
    if "--no-save" in sys.argv:
        save = None
    load_env()
    note = credentials_note()
    if note:
        print(note)
    try:
        mission = mission_of(getattr(build_settings, "__code__", None) and build_settings.__code__.co_filename)
        agent = asyncio.run(run_resilient_async(build_settings, on_event, save_audio=save, mic="--mic" in sys.argv, mission=mission))
    except SetupError as err:
        print(err, file=sys.stderr)
        sys.exit(2)
    except KeyboardInterrupt:
        print("\n[bye]")
        return
    except Exception as err:
        print_crash(err)
        sys.exit(1)
    sys.exit(exit_status(agent))
