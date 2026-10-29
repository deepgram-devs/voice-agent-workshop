"""Mission 02, Read the room: notice a frustrated caller and change course once.

Run it:    make run 02   (or, from python/: uv run python missions/02-read-the-room/start.py)
           needs DEEPGRAM_API_KEY or your workshop token in .env; in Docker: docker compose run --rm workshop make run 02
Check it:  make check 02     (offline, no key)
Live:      make live 02      (real API: needs DEEPGRAM_API_KEY or your workshop token in .env; the timing feature too, see the README)

Three TODOs below. The brief is in ../../../missions/02-read-the-room/README.md.
"""

from agent.common import Agent, Event, listen_provider, run

PROMPT = (
    "You are a patient receptionist at a developer conference. "
    "Keep replies to one or two short sentences. Never use markdown or emoji."
)

# TODO 1: Pick a frustration limit: how many annoyed turns before FrustrationDetected
# says escalated. A whole number from 1 to 5.
FRUSTRATION_LIMIT = None

# TODO 2: UpdatePrompt adds to the prompt the agent already has. This sends the
# whole prompt again, so the agent ends up with it twice. Keep only the new lines.
RECOVERY = PROMPT + (
    " The caller is frustrated. Say sorry once, stop asking questions, "
    "and offer to have someone from registration call them back within the hour."
)

# One call, one recovery. Reset when a new call starts.
recovered = False


def build_settings() -> dict:
    """The Settings message: sent once, as soon as the server says Welcome."""
    timing: dict = {"type": "deepgram", "version": "v1"}
    if FRUSTRATION_LIMIT is not None:
        timing["frustration_max_count"] = FRUSTRATION_LIMIT
    return {
        "audio": {
            "input": {"encoding": "linear16", "sample_rate": 16000},
            "output": {"encoding": "linear16", "sample_rate": 24000, "container": "none"},
        },
        "agent": {
            "listen": {"provider": listen_provider()},
            "think": {"provider": {"type": "open_ai", "model": "gpt-4o-mini"}, "prompt": PROMPT},
            "speak": {"provider": {"type": "deepgram", "model": "flux-hannah-en", "version": "v2"}},
            # The timing block sits beside listen, think and speak.
            "think_live": {"provider": timing},
        },
    }


async def on_event(agent: Agent, event: Event) -> None:
    """Every event from the agent lands here, as a plain dict."""
    global recovered
    if event["type"] == "Welcome":
        recovered = False  # a new call
    elif event["type"] == "FrustrationDetected":
        print(f"[frustration] count {event.get('count')}, escalated {event.get('escalated')}")
        # TODO 3: This sends the recovery on every frustration event, so the agent
        # apologizes again and again. Send it once: the first time `escalated` is
        # true. The `recovered` flag above is there to help.
        await agent.update_prompt(RECOVERY)


if __name__ == "__main__":
    run(build_settings, on_event)
