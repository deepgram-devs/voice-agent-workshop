"""The smallest Voice Agent program on the Deepgram Python SDK, with no helpers.

It sends Settings, waits for SettingsApplied before it sends anything else, lets
you type turns, and saves the agent's voice to out/last-call.wav, as `make run`
does. The missions do the same through agent/common.py, which adds the workshop
token path, error hints and --mic; read this file to see the SDK calls on their own.

Run it from python/:   uv run python examples/first_settings.py [path/to/voice.wav]
It reads DEEPGRAM_API_KEY from ../.env or the shell. Type a line and press Enter;
Ctrl-C hangs up. DEEPGRAM_AGENT_URL picks another agent host (the offline test uses it).
"""

from __future__ import annotations

import asyncio
import os
import sys
import threading
import wave
from pathlib import Path

import websockets
from dotenv import load_dotenv

from deepgram import AsyncDeepgramClient
from deepgram.agent.v1.types import AgentV1InjectUserMessage, AgentV1Settings
from deepgram.core.api_error import ApiError
from deepgram.environment import DeepgramClientEnvironment

PROJECT_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_RATE = 24000

SETTINGS = {
    "type": "Settings",
    "audio": {
        "input": {"encoding": "linear16", "sample_rate": 16000},
        "output": {"encoding": "linear16", "sample_rate": OUTPUT_RATE, "container": "none"},
    },
    "agent": {
        "listen": {"provider": {"type": "deepgram", "model": "nova-3", "version": "v1"}},
        "think": {"provider": {"type": "open_ai", "model": "gpt-4o-mini"}, "prompt": "You are a friendly voice agent. Keep replies short."},
        "speak": {"provider": {"type": "deepgram", "model": "flux-hannah-en", "version": "v2"}},
        "greeting": "Hi there. Type something and I will answer.",
    },
}


def make_client(key: str) -> AsyncDeepgramClient:
    host = os.environ.get("DEEPGRAM_AGENT_URL", "").strip().rstrip("/").removesuffix("/v1/agent/converse")
    if not host:
        return AsyncDeepgramClient(api_key=key)  # production: wss://agent.deepgram.com
    rest = host.replace("wss://", "https://", 1).replace("ws://", "http://", 1)
    env = DeepgramClientEnvironment(base="https://api.deepgram.com", production="wss://api.deepgram.com", agent=host, agent_rest=rest)
    return AsyncDeepgramClient(api_key=key, environment=env)


def kind_of(message) -> str | None:
    """Known events arrive as SDK models, newer ones as dicts."""
    return message.get("type") if isinstance(message, dict) else getattr(message, "type", None)


def field(message, name: str):
    return message.get(name) if isinstance(message, dict) else getattr(message, name, None)


def save_wav(path: Path, chunks: list[bytes]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)  # linear16
        w.setframerate(OUTPUT_RATE)
        w.writeframes(b"".join(chunks))
    print(f"[saved] the agent's voice is in {path}")


async def main(wav_path: Path) -> int:
    load_dotenv(PROJECT_ROOT / ".env", override=False)
    key = os.environ.get("DEEPGRAM_API_KEY", "").strip()
    if not key:
        # The same two states as the missions' line (agent.common), in this example's own words:
        # it reads the key only; the helpers add the workshop token path.
        if (PROJECT_ROOT / ".env").is_file():
            print("DEEPGRAM_API_KEY is empty in .env (this folder). Set it: this example runs "
                  "on your own key only (make run takes a workshop token too). "
                  "make check NN runs offline with no key.", file=sys.stderr)
        else:
            print("No Deepgram credentials. Copy .env.example to .env and set DEEPGRAM_API_KEY "
                  "(free key: https://console.deepgram.com/signup): this example runs on "
                  "your own key only (make run takes a workshop token too).", file=sys.stderr)
        return 2
    # Printable ASCII only: a header can't carry a curly quote, and a space is a paste error.
    if not all(0x21 <= ord(c) <= 0x7E for c in key):
        print("DEEPGRAM_API_KEY has a character a key can't have (a curly quote or a hidden space, "
              "often from copy and paste). Copy it again as plain text.", file=sys.stderr)
        return 2

    loop = asyncio.get_running_loop()
    ready = asyncio.Event()  # set when SettingsApplied arrives
    lines: asyncio.Queue[str] = asyncio.Queue()
    audio: list[bytes] = []

    def read_stdin() -> None:  # a thread, so waiting on the keyboard never blocks the socket
        for line in sys.stdin:
            if line.strip():
                loop.call_soon_threadsafe(lines.put_nowait, line.strip())

    try:
        async with make_client(key).agent.v1.connect() as socket:
            # 1. Settings first, before any audio or text: the agent ignores everything until then.
            await socket.send_settings(AgentV1Settings(**SETTINGS))

            async def send_turns() -> None:
                await ready.wait()  # 2. nothing else goes out until SettingsApplied
                while True:
                    line = await lines.get()
                    await socket.send_inject_user_message(AgentV1InjectUserMessage(type="InjectUserMessage", content=line))

            async def keep_alive() -> None:
                await ready.wait()
                while True:  # no audio flows from this program, so KeepAlive holds the line open
                    await asyncio.sleep(5)
                    await socket.send_keep_alive()

            threading.Thread(target=read_stdin, daemon=True).start()
            tasks = [asyncio.create_task(send_turns()), asyncio.create_task(keep_alive())]
            try:
                async for message in socket:
                    if isinstance(message, bytes):
                        audio.append(message)  # 3. the agent's voice: linear16 at 24 kHz
                        continue
                    kind = kind_of(message)
                    if kind == "SettingsApplied":
                        ready.set()
                        print("[ready] type a line and press Enter")
                    elif kind == "ConversationText":
                        print(f"{field(message, 'role')}: {field(message, 'content')}")
                    elif kind == "Error":
                        print(f"Agent error: {field(message, 'description')} ({field(message, 'code')})")
            except websockets.exceptions.ConnectionClosed as closed:
                if closed.rcvd and closed.rcvd.code != 1000:
                    print(f"[closed] {closed.rcvd.code} {closed.rcvd.reason}")
            finally:
                for task in tasks:
                    task.cancel()
    except ApiError as err:
        # Print the status only: the error object carries the request headers, key included.
        print(f"Deepgram refused the connection (HTTP {err.status_code}).", file=sys.stderr)
        return 2
    except OSError as err:
        # Nothing answered, or the host did not resolve: the helpers' one line (agent/common.py
        # unreachable_line), never asyncio's own text, which carries the address.
        refused = isinstance(err, ConnectionRefusedError) or "Connect call failed" in str(err)
        detail = "connection refused" if refused else (err.strerror or type(err).__name__)
        print(f"Could not reach the agent: {detail}. Check DEEPGRAM_AGENT_URL.", file=sys.stderr)
        return 2
    finally:
        if audio:
            save_wav(wav_path, audio)
    return 0


if __name__ == "__main__":
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else PROJECT_ROOT / "out" / "last-call.wav"
    try:
        sys.exit(asyncio.run(main(out)))
    except KeyboardInterrupt:
        print("\n[bye]")
