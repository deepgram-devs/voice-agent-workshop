"""Mission 00, First words: get an agent talking back in a voice you picked.

Run it:    uv run python missions/00-first-words/solution.py
Check it:  make check 00      (offline, no key)
Live:      make live 00       (real API, uses your DEEPGRAM_API_KEY)

Reference solution. Try start.py first.
"""

from agent.common import Agent, Event, listen_provider, run

# Your own prompt: who it is, how it talks, one rule.
PROMPT = (
    "You are Sam, the barista at a tiny cafe. Answer in one short sentence, "
    "then ask one question back. Never recommend decaf."
)

# A different voice from the default.
VOICE = "flux-cliff-en"

# The first thing it says when you connect.
GREETING = "Hi, welcome in. What can I get started for you?"


def build_settings() -> dict:
    """The Settings message: sent once, as soon as the server says Welcome."""
    agent: dict = {
        "listen": {"provider": listen_provider()},
        "think": {"provider": {"type": "open_ai", "model": "gpt-4o-mini"}, "prompt": PROMPT},
        "speak": {"provider": {"type": "deepgram", "model": VOICE, "version": "v2"}},
    }
    if GREETING:
        agent["greeting"] = GREETING
    return {
        "audio": {
            "input": {"encoding": "linear16", "sample_rate": 16000},
            "output": {"encoding": "linear16", "sample_rate": 24000, "container": "none"},
        },
        "agent": agent,
    }


async def on_event(agent: Agent, event: Event) -> None:
    """Every event from the agent lands here. common.py already prints the
    transcript; nothing else to do in this mission."""


if __name__ == "__main__":
    run(build_settings, on_event)
