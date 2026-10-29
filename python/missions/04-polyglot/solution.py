"""Mission 04, Polyglot: one listener for every language, and a voice that follows.

Run it:    uv run python missions/04-polyglot/solution.py
Check it:  make check 04      (offline, no key)
Live:      make live 04       (real API, uses your DEEPGRAM_API_KEY)

Reference solution. Try start.py first.
"""

from typing import Optional

from agent.common import Agent, Event, run

# The multilingual listener, and the languages you expect to hear.
LISTEN_MODEL = "flux-general-multi"
LANGUAGE_HINTS = ["en", "es", "fr"]

PROMPT = (
    "You are a friendly help desk at a conference. Answer in one or two short "
    "sentences, always in the language the person just used."
)

# One Aura-2 voice per language. To try other voices, including multi_tts
# voices, swap the ids here and nothing else changes.
VOICES = {
    "en": "aura-2-thalia-en",
    "es": "aura-2-celeste-es",
    "de": "aura-2-julius-de",
    "fr": "aura-2-agathe-fr",
    "it": "aura-2-livia-it",
    "nl": "aura-2-rhea-nl",
    "ja": "aura-2-izanami-ja",
}
START_LANGUAGE = "en"


def speak_for(language: str) -> dict:
    """The `speak` block for one language's voice, for Settings and UpdateSpeak."""
    return {"provider": {"type": "deepgram", "model": VOICES[language]}}


def first_language(event: Event) -> Optional[str]:
    """The language a user turn was mostly in ("es" from "es-419"), or None.
    `languages` lists what the listener heard, most words first."""
    heard = event.get("languages") or []
    return str(heard[0]).split("-")[0].lower() if heard else None


class Voice:
    """Which voice the agent speaks with, and the one it had before a switch."""

    language = START_LANGUAGE
    previous: Optional[str] = None  # set while an UpdateSpeak waits for its answer


def build_settings() -> dict:
    """The Settings message: sent once, as soon as the server says Welcome."""
    listen: dict = {"type": "deepgram", "model": LISTEN_MODEL, "version": "v2"}
    if LANGUAGE_HINTS:
        listen["language_hints"] = LANGUAGE_HINTS
    return {
        "audio": {
            "input": {"encoding": "linear16", "sample_rate": 16000},
            "output": {"encoding": "linear16", "sample_rate": 24000, "container": "none"},
        },
        "agent": {
            "listen": {"provider": listen},
            "think": {"provider": {"type": "open_ai", "model": "gpt-4o-mini"}, "prompt": PROMPT},
            "speak": speak_for(START_LANGUAGE),
        },
    }


async def on_event(agent: Agent, event: Event) -> None:
    kind = event.get("type")
    if kind == "Welcome":
        # A new call starts with the starting voice.
        Voice.language, Voice.previous = START_LANGUAGE, None

    elif kind == "ConversationText" and event.get("role") == "user":
        heard = first_language(event)
        if heard and heard != Voice.language and heard in VOICES:
            # Switch once: remember the old voice in case the switch fails.
            Voice.previous, Voice.language = Voice.language, heard
            await agent.update_speak(speak_for(heard))
            print(f"[voice] switching to {VOICES[heard]} from the next reply")

    elif kind == "SpeakUpdated":
        Voice.previous = None

    elif kind == "Error" and Voice.previous:
        # The switch failed, and the server ends the call after this error.
        # Say what happened in one line and hang up, so the program ends cleanly.
        reason = str(event.get("description") or event.get("code") or "no reason given")
        # The line below adds its own period.
        reason = reason.removesuffix(".")
        print(f"[voice] couldn't switch to {VOICES[Voice.language]}: {reason}. Ending the call.")
        await agent.close()


if __name__ == "__main__":
    run(build_settings, on_event)
