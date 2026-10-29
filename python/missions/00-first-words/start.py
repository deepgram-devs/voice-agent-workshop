"""Mission 00, First words: get an agent talking back in a voice you picked.

Run it:    make run 00   (or, from python/: uv run python missions/00-first-words/start.py)
           needs DEEPGRAM_API_KEY or your workshop token in .env; in Docker: docker compose run --rm workshop make run 00
Check it:  make check 00     (offline, no key)
Live:      make live 00      (real API: needs DEEPGRAM_API_KEY or your workshop token in .env)

Three TODOs below. The brief is in ../../../missions/00-first-words/README.md.
"""

from agent.common import Agent, Event, listen_provider, run

# TODO 1: Write your own prompt. Who is the agent, how does it talk, and one rule
# it always follows. A sentence or three is plenty.
PROMPT = "You are a helpful assistant."

# TODO 2: Pick a different voice by id: flux-cliff-en, flux-alexis-en or flux-rufus-en, or one from the brief.
VOICE = "flux-hannah-en"

# TODO 3: Give it a greeting: the first thing it says when you connect.
GREETING = ""


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
