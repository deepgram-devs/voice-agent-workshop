"""Mission 06, Encore (bonus): push Speed and Expressivity until it does an impression.

Run it:    uv run python missions/06-encore/solution.py
Check it:  make check 06      (offline, no key)
Live:      make live 06       (real API, uses your DEEPGRAM_API_KEY)

Reference solution. Try start.py first.
"""

from agent.common import Agent, Event, listen_provider, run

# A performance, not a persona: who is talking, and what they narrate.
PROMPT = (
    "You are a nature documentary narrator describing whatever the listener says as if it "
    "were a rare animal in the wild. Hushed, awed, one or two sentences a turn. Never break character."
)

# A Flux voice (version v2): Speed and Expressivity belong to Flux voices.
VOICE = "flux-hannah-en"

# Slower, for gravitas.
SPEED = 0.9

# Leaning into the words. It holds for the whole call.
EXPRESSIVITY = 1

GREETING = "Ready when you are. Tell me what you see."


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
            "speak": {
                "provider": {"type": "deepgram", "model": VOICE, "version": "v2", "speed": SPEED, "expressivity": EXPRESSIVITY},
            },
            "greeting": GREETING,
        },
    }


async def on_event(agent: Agent, event: Event) -> None:
    """Every event from the agent lands here. common.py already prints the
    transcript; nothing else to do in this mission."""


if __name__ == "__main__":
    run(build_settings, on_event)
