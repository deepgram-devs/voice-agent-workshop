"""Mission 02, Read the room: notice a frustrated caller and change course once.

Run it:    uv run python missions/02-read-the-room/solution.py
Check it:  make check 02      (offline, no key)
Live:      make live 02       (real API; needs the `timing` feature, see the README)

Reference solution. Try start.py first.
"""

from agent.common import Agent, Event, listen_provider, run

PROMPT = (
    "You are a patient receptionist at a developer conference. "
    "Keep replies to one or two short sentences. Never use markdown or emoji."
)

# How many annoyed turns before FrustrationDetected says escalated.
FRUSTRATION_LIMIT = 2

# What the agent does once the caller has had enough. UpdatePrompt adds this to
# the prompt the agent already has, so it holds only the new lines.
RECOVERY = (
    "The caller is frustrated. Say sorry once, stop asking questions, "
    "and offer to have someone from registration call them back within the hour."
)

# One call, one recovery. Reset when a new call starts.
recovered = False


def build_settings() -> dict:
    """The Settings message: sent once, as soon as the server says Welcome."""
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
            "think_live": {
                "provider": {
                    "type": "deepgram",
                    "version": "v1",
                    "frustration_max_count": FRUSTRATION_LIMIT,
                },
            },
        },
    }


async def on_event(agent: Agent, event: Event) -> None:
    """Every event from the agent lands here, as a plain dict."""
    global recovered
    if event["type"] == "Welcome":
        recovered = False  # a new call
    elif event["type"] == "FrustrationDetected":
        print(f"[frustration] count {event.get('count')}, escalated {event.get('escalated')}")
        if event.get("escalated") and not recovered:
            recovered = True
            await agent.update_prompt(RECOVERY)


if __name__ == "__main__":
    run(build_settings, on_event)
