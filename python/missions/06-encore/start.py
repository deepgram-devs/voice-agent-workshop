"""Mission 06, Encore (bonus): push Speed and Expressivity until it does an impression.

Run it:    make run 06   (or, from python/: uv run python missions/06-encore/start.py)
           needs DEEPGRAM_API_KEY or your workshop token in .env; in Docker: docker compose run --rm workshop make run 06
Check it:  make check 06     (offline, no key)
Live:      make live 06      (real API: needs DEEPGRAM_API_KEY or your workshop token in .env)

Three TODOs below. The brief is in ../../../missions/06-encore/README.md.
"""

from agent.common import Agent, Event, listen_provider, run

# TODO 1: Ask for a performance: who is talking, and what they narrate.
PROMPT = "You are a helpful assistant."

# A Flux voice (version v2): Speed and Expressivity belong to Flux voices.
VOICE = "flux-hannah-en"

# TODO 2: Change the speed: 0.85 to 1.15, in steps of 0.05. 1 is normal.
SPEED = 1.0

# TODO 3: Change the expressivity: a whole number from -2 (calm) to 2 (animated).
# 0 is the voice's own delivery. It holds for the whole call.
EXPRESSIVITY = 0

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
