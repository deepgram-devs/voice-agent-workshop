"""Mission 03, No dead air: answer a tool call, and cover the wait while a slow one runs.

Run it:    make run 03   (or, from python/: uv run python missions/03-no-dead-air/start.py)
           needs DEEPGRAM_API_KEY or your workshop token in .env; in Docker: docker compose run --rm workshop make run 03
Check it:  make check 03     (offline, no key)
Live:      make live 03      (real API: needs DEEPGRAM_API_KEY or your workshop token in .env)

Three TODOs below. In the event handler TODO 3 sits above TODO 2: the filler goes out before
the tool runs. The brief is in ../../../missions/03-no-dead-air/README.md.
"""

import asyncio
import json
import os

from agent.common import Agent, Event, listen_provider, run

PROMPT = (
    "You are a to-do list assistant at a developer conference. Keep replies to one short sentence. "
    "Use the tools to add, list, complete and delete items, and confirm what you did. "
    "Never use markdown or emoji."
)

# The list every call starts with, so there is something to delete straight away.
SEED_ITEMS = ["Buy milk", "Call the dentist", "Book the flight home"]

# deleteItem is slow on purpose, like a lookup against a slow database.
SLOW_SECONDS = 3
SLOW_TOOLS = {"deleteItem"}

# What the agent says while a slow tool runs.
FILLER = "One second, let me find that."


def _item_param(what: str) -> dict:
    return {
        "type": "object",
        "properties": {"item": {"type": "string", "description": f"{what}, in the caller's words. A partial match is fine."}},
        "required": ["item"],
    }


# The four functions the agent can call. They travel in Settings as agent.think.functions.
FUNCTIONS = [
    {"name": "deleteItem", "description": "Delete an item from the to-do list for good. This lookup is slow and takes about three seconds.", "parameters": _item_param("The item to delete")},
    {"name": "completeItem", "description": "Mark an item on the to-do list as done. It stays on the list.", "parameters": _item_param("The item to mark as done")},
    {"name": "addItem", "description": "Add a new item to the to-do list.", "parameters": _item_param("The item to add")},
    {"name": "listItems", "description": "Read back every item on the to-do list with whether it is done.", "parameters": {"type": "object", "properties": {}}},
]

# The to-do list for this call. on_event resets it when a call starts.
items: list[dict] = []


def find_item(query: str) -> dict | None:
    """The item whose text best matches what the caller said, or None."""
    q = str(query or "").strip().lower()
    if not q:
        return None
    for item in items:
        if q in item["text"].lower() or item["text"].lower() in q:
            return item
    words = [w for w in q.split() if len(w) > 2]
    scored = [(sum(w in item["text"].lower() for w in words), item) for item in items]
    best = max(scored, key=lambda pair: pair[0], default=(0, None))
    return best[1] if best[0] > 0 else None


def count() -> str:
    return f"{len(items)} item{'' if len(items) == 1 else 's'} on the list."


async def add_item(args: dict) -> str:
    text = str(args.get("item", "")).strip()
    if not text:
        return "Nothing to add: the item was empty."
    items.append({"text": text, "done": False})
    return f'Added "{text}". {count()}'


async def list_items(args: dict) -> str:
    if not items:
        return "The list is empty."
    return " ".join(f"{n}. {i['text']}{' (done)' if i['done'] else ''}" for n, i in enumerate(items, 1))


async def complete_item(args: dict) -> str:
    hit = find_item(args.get("item", ""))
    if not hit:
        return f'No item matching "{args.get("item", "")}". {count()}'
    hit["done"] = True
    return f'Marked "{hit["text"]}" as done.'


async def delete_item(args: dict) -> str:
    await asyncio.sleep(SLOW_SECONDS)  # the slow lookup this mission is built around
    # TODO 1: Delete the item and say what you did. The agent reads whatever you return out loud,
    # so return a short sentence, and say so when nothing matches (complete_item shows the pattern):
    # hit = find_item(args.get("item", ""))
    # if not hit:
    #     return ...
    # items.remove(hit)
    # return ...
    return "TODO"


TOOLS = {"addItem": add_item, "listItems": list_items, "completeItem": complete_item, "deleteItem": delete_item}


async def run_tool(name: str, args: dict) -> str:
    tool = TOOLS.get(name)
    return await tool(args) if tool else f"Unknown function: {name}"


def build_settings() -> dict:
    """The Settings message: sent once, as soon as the server says Welcome."""
    return {
        "audio": {
            "input": {"encoding": "linear16", "sample_rate": 16000},
            "output": {"encoding": "linear16", "sample_rate": 24000, "container": "none"},
        },
        "agent": {
            "listen": {"provider": listen_provider()},
            "think": thinking_think() if THINKING_MODEL else {"provider": {"type": "open_ai", "model": "gpt-4o-mini"}, "prompt": PROMPT, "functions": FUNCTIONS},
            "speak": {"provider": {"type": "deepgram", "model": "flux-hannah-en", "version": "v2"}},
        },
    }


async def on_event(agent: Agent, event: Event) -> None:
    """Every event from the agent lands here, as a plain dict."""
    if event["type"] == "Welcome":
        items[:] = [{"text": text, "done": False} for text in SEED_ITEMS]  # a fresh list per call
    elif event["type"] == "FunctionCallRequest":
        for call in event.get("functions") or []:
            if call.get("client_side") is False:
                continue  # the agent runs this one itself; answer only the calls meant for your code
            # TODO 3: A slow tool leaves the caller in silence. Before a tool in SLOW_TOOLS runs, have
            # the agent say FILLER:
            # if call["name"] in SLOW_TOOLS:
            #     await agent.inject_agent_message(FILLER, behavior="queue")
            args = json.loads(call.get("arguments") or "{}")
            result = await run_tool(call["name"], args)
            # TODO 2: The agent matches each answer to its request by id. Send this call's id, call["id"], in place of "".
            await agent.function_call_response("", call["name"], result)


# Stretch (optional, not checked): the `thinking` feature, a think provider built
# for voice that covers the wait on its own. Put its model id in .env as
# THINKING_MODEL and your Settings ask for it (missions/03-no-dead-air/README.md).
THINKING_MODEL = os.environ.get("THINKING_MODEL", "").strip()


def thinking_think() -> dict:
    """The think block for the `thinking` provider, sent in your Settings.
    If it runs on its own agent endpoint, put that endpoint in DEEPGRAM_AGENT_URL."""
    return {
        "provider": {"type": "deepgram", "model": THINKING_MODEL, "reasoning_mode": "none"},
        "prompt": PROMPT,
        "functions": FUNCTIONS,
    }


if __name__ == "__main__":
    run(build_settings, on_event)
