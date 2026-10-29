"""Mission 01, Let me finish: an agent that waits while you talk, and hangs up when you say goodbye.

Run it:    uv run python missions/01-let-me-finish/solution.py
Check it:  make check 01      (offline, no key)
Live:      make live 01       (real API; needs the timing feature, see the README)

Reference solution. Try start.py first.
"""

from agent.common import Agent, Event, listen_provider, run

PROMPT = (
    "You are a patient receptionist taking down a caller's phone number. "
    "Keep replies to one short sentence. When the caller says goodbye or has "
    "nothing else to add, call end_call straight away, before you say anything."
)
VOICE = "flux-hannah-en"
GREETING = "Hi, you've reached the front desk. Would you like to leave a number?"

# The timing knobs. Real wire names; the feature key is `timing`.
BACKCHANNEL = 0.3  # 0 to 1: how readily it says "mm-hm" instead of taking the turn
PRESENCE_INTERVAL_MS = 4000  # silence before it asks whether you're still there
PRESENCE_MAX = 2  # how many times it asks. It never hangs up by itself.

# Hearing: the speech-to-text model (LISTEN_MODEL in .env picks another).
LISTEN = listen_provider()

# Declared in Settings, so the agent can ask your code to end the call.
END_CALL = {
    "name": "end_call",
    "description": (
        "End the phone call. Call this once the caller has said goodbye and "
        "has nothing else to add."
    ),
    "parameters": {"type": "object", "properties": {}},
}

# One call's state. A new call starts at Welcome.
call = {"hang_up_pending": False}


def build_settings() -> dict:
    """The Settings message: sent once, as soon as the server says Welcome."""
    agent: dict = {
        "listen": {"provider": LISTEN},
        "think": {
            "provider": {"type": "open_ai", "model": "gpt-4o-mini"},
            "prompt": PROMPT,
            "functions": [END_CALL],
        },
        "speak": {"provider": {"type": "deepgram", "model": VOICE, "version": "v2"}},
        "greeting": GREETING,
    }
    # The timing block.
    agent["think_live"] = {
        "provider": {
            "type": "deepgram",
            "version": "v1",
            "agent_backchannel_sensitivity": BACKCHANNEL,
            "presence_check_interval_ms": PRESENCE_INTERVAL_MS,
            "presence_check_max_count": PRESENCE_MAX,
        },
    }
    return {
        "audio": {
            "input": {"encoding": "linear16", "sample_rate": 16000},
            "output": {"encoding": "linear16", "sample_rate": 24000, "container": "none"},
        },
        "agent": agent,
    }


async def on_event(agent: Agent, event: Event) -> None:
    """Every event from the agent lands here."""
    kind = event["type"]
    if kind == "Welcome":
        call["hang_up_pending"] = False

    elif kind == "FunctionCallRequest":
        for fn in event.get("functions") or []:
            if fn.get("name") == "end_call":
                await agent.function_call_response(fn["id"], "end_call", "The call is ending. Say a short goodbye.")
                call["hang_up_pending"] = True

    elif kind == "AgentAudioDone" and call["hang_up_pending"]:
        # The goodbye has finished playing: now hang up.
        print("[hang up] the agent said goodbye")
        await agent.close()


if __name__ == "__main__":
    run(build_settings, on_event)
