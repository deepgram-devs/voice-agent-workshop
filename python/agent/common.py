"""Every place this project touches the Deepgram Python SDK lives in this file.

Missions import from here and never from `deepgram` directly, so an SDK upgrade
is a change to one file. What it gives a mission:

    run(build_settings, on_event)   connect, send your Settings, print the transcript,
                                    let you type turns, save the agent's voice to a WAV
    listen_provider()               the listen model every mission uses (LISTEN_MODEL in .env)
    Agent                           the senders a mission needs: update_prompt,
                                    inject_agent_message, function_call_response, ...
    send_raw                        the escape hatch for JSON the SDK doesn't model

Events reach `on_event` as plain dicts shaped like the wire JSON, whether the SDK
knows the event type or not. Compare on `event["type"]`.
"""

from __future__ import annotations

import argparse
import asyncio
import io
import logging
import os
import re
import sys
import threading
import traceback
import wave
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional

import pydantic
import websockets
from dotenv import load_dotenv
from dotenv.parser import parse_stream
from websockets.exceptions import InvalidURI
from websockets.uri import parse_uri

from deepgram import AsyncDeepgramClient
from deepgram.agent.v1.types import (
    AgentV1InjectAgentMessage,
    AgentV1InjectUserMessage,
    AgentV1SendFunctionCallResponse,
    AgentV1Settings,
    AgentV1UpdatePrompt,
    AgentV1UpdateSpeak,
    AgentV1UpdateThink,
)
from deepgram.core.api_error import ApiError
from deepgram.environment import DeepgramClientEnvironment

PROJECT_ROOT = Path(__file__).resolve().parents[2]
PROD_AGENT_URL = "wss://agent.deepgram.com"
AGENT_PATH = "/v1/agent/converse"
KEEPALIVE_SECONDS = 5
PIPED_REPLY_SECONDS = 30  # how long a piped line waits for its reply before the next goes
HUNG_UP_LINE = "[bye] your program hung up."
NO_AUDIO_LINE = "[no audio] The agent sent no audio on this call, so there is no new out/last-call.wav."

Event = dict[str, Any]
BuildSettings = Callable[[], dict]
OnEvent = Callable[["Agent", Event], Awaitable[None]]

# Event types newer than the SDK reach missions as plain dicts, with no warning.
# The SDK's socket logs a warning only when it skips a message it can't parse
# at all; that line would interleave with the conversation, so it stays quiet.
logging.getLogger("deepgram.agent.v1.socket_client").setLevel(logging.ERROR)
# python-dotenv's own warning ("could not parse statement", once per read) is replaced by
# load_env's line, which says what to fix, once a run, in Java's words.
logging.getLogger("dotenv.main").setLevel(logging.ERROR)


class SetupError(Exception):
    """A problem the attendee can fix (missing key, bad URL). Printed without a traceback.

    `retryable` is True when trying again later can help (the network dropped, or the
    server was busy), and False when something has to change first (a refused key)."""

    def __init__(self, message: str, *, retryable: bool = False):
        super().__init__(message)
        self.retryable = retryable


# ---------------------------------------------------------------------------
# Printing errors safely: nothing printed may carry a key or a request header
# ---------------------------------------------------------------------------

_AUTH_HEADER = re.compile(r"(?i)(['\"]?authorization['\"]?\s*[:=]\s*['\"]?)[^'\",}\n]*")
_AUTH_VALUE = re.compile(r"(?i)\b(token|bearer)(\s+)[A-Za-z0-9._~+/=-]{12,}")
_AUTH_HEADER_LINE = re.compile(r"(?i)(\bauthorization header:[ \t]*)[^\n]*")


def redact(text: str) -> str:
    """Mask anything that looks like a credential: the configured key and token,
    an Authorization header in any form, and `Token ...` / `Bearer ...` values."""
    for name in ("DEEPGRAM_API_KEY", "WORKSHOP_TOKEN"):
        secret = os.environ.get(name, "").strip()
        if len(secret) >= 8:
            text = text.replace(secret, "[redacted]")
    text = _AUTH_HEADER_LINE.sub(lambda m: m.group(1) + "[redacted]", text)
    text = _AUTH_HEADER.sub(lambda m: m.group(1) + "[redacted]", text)
    return _AUTH_VALUE.sub(lambda m: m.group(1) + m.group(2) + "[redacted]", text)


def describe_error(err: BaseException) -> str:
    """One printable line for an exception. SDK ApiErrors carry the request
    headers, key included, so for those only the status code is used."""
    if isinstance(err, ApiError):
        return f"Deepgram refused the connection (HTTP {err.status_code})"
    return redact(f"{type(err).__name__}: {err}")


def print_crash(err: BaseException) -> None:
    """Print an unexpected error's traceback to stderr, redacted like every other line."""
    print(redact("".join(traceback.format_exception(type(err), err, err.__traceback__))).rstrip(), file=sys.stderr)


# ---------------------------------------------------------------------------
# Configuration: keys and URLs come from the environment or ../.env
# ---------------------------------------------------------------------------


ENV_NOT_UTF8 = ".env isn't UTF-8 text, so none of it was read. Save it as UTF-8 (plain text), then run this again."
# KEY= then a quote: python-dotenv dropped the line for its quotes (Java's Env.unreadLine).
_QUOTED_LINE = re.compile(r"""\s*(?:export\s+)?(?:'[^']+'|[^'=#\s][^=#\s]*)\s*=\s*['"]""")
_env_said: set[str] = set()


def env_bad_line(n: int) -> str:
    """The line for a .env line that isn't KEY=value: Java's Env.badLine, word for word."""
    return f".env line {n} couldn't be read: it isn't KEY=value. Fix that line, then run this again."


def env_unread_line(n: int) -> str:
    """The line for a .env line dropped for its quotes: Java's Env.unreadLine, word for word."""
    return (
        f".env line {n} couldn't be read: its quote never closes, or text follows the closing quote. "
        "Fix that line, then run this again."
    )


def env_problems(text: str) -> list[str]:
    """One line for each .env line python-dotenv drops, found by its own parser."""
    return [
        (env_unread_line if _QUOTED_LINE.match(b.original.string) else env_bad_line)(b.original.line)
        for b in parse_stream(io.StringIO(text))
        if b.error
    ]


def _dotenv_disabled() -> bool:
    """PYTHON_DOTENV_DISABLED, as python-dotenv reads it: then .env is neither read nor named."""
    return os.environ.get("PYTHON_DOTENV_DISABLED", "").casefold() in {"1", "true", "t", "yes", "y"}


def load_env(path: Optional[Path] = None, *, quiet: bool = False) -> None:
    """Read .env in the voice-agent-workshop folder. Variables already set in the shell win.
    A line it can't read, or a file that isn't UTF-8, gets one line on stderr, once a run;
    `quiet` leaves that to a later call (pytest would swallow the import's)."""
    if _dotenv_disabled():
        return
    try:
        text = (path or PROJECT_ROOT / ".env").read_text(encoding="utf-8")
        problems = env_problems(text)
    except UnicodeDecodeError:
        text, problems = "", [ENV_NOT_UTF8]
    except OSError:
        return  # no .env: the shell's variables only
    for line in [] if quiet else problems:
        if line not in _env_said:
            _env_said.add(line)
            print(line, file=sys.stderr)
    load_dotenv(stream=io.StringIO(text), override=False)


# Loaded on import, so a mission's module-level settings (THINKING_MODEL, say) see .env
# too. run(), run_async() and the checks load it again and say what they couldn't read;
# the shell still wins.
load_env(quiet=True)


# What DEEPGRAM_AGENT_URL or WORKSHOP_URL must look like, the same pattern body in common.ts,
# Credentials.java and the harness (tools/parity/addresses.json): ws:// or wss://, a host, an
# optional port from 1 to 65535, then printable ASCII only. Checked before connecting, so a typo
# is one line, never a traceback.
_ADDRESS = re.compile(r"wss?://(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9._-]+)(?::([0-9]{1,5}))?(?:[/?#][\x21-\x7E]*)?")
BAD_AGENT_URL = "DEEPGRAM_AGENT_URL isn't a valid address. Copy it again, or leave it empty for Deepgram production."
BAD_WORKSHOP_URL = "WORKSHOP_URL isn't a valid address. Copy it again from the workshop's /code page."


def valid_address(url: str) -> bool:
    """True when `url` is an address the SDK can open. websockets' own parser backs the pattern up."""
    m = _ADDRESS.fullmatch(url)
    if not m or (m.group(2) is not None and not 1 <= int(m.group(2)) <= 65535):
        return False
    try:
        parse_uri(url + AGENT_PATH)
    except (InvalidURI, ValueError):
        return False
    return True


def agent_base_url(raw: Optional[str]) -> str:
    """DEEPGRAM_AGENT_URL may be a host (wss://agent.deepgram.com) or the full
    converse URL. The SDK adds /v1/agent/converse itself, so strip it."""
    url = (raw or PROD_AGENT_URL).strip().rstrip("/")
    if url.endswith(AGENT_PATH):
        url = url[: -len(AGENT_PATH)]
    if not url.startswith(("ws://", "wss://")):
        # The value stays out of the message: it can name an endpoint that belongs out of logs.
        raise SetupError("DEEPGRAM_AGENT_URL must start with wss:// (or ws:// for the local check harness). Leave it empty for Deepgram production.")
    if not valid_address(url):
        raise SetupError(BAD_AGENT_URL)  # the value stays out of this one too
    return url


_MISSION_DIR = re.compile(r"^\d{2}-[a-z0-9-]+$")


def mission_of(path: Any) -> Optional[str]:
    """The mission folder a file lives in ("00-first-words"), or None."""
    try:
        name = Path(path).resolve().parent.name
    except (TypeError, OSError):
        return None
    return name if _MISSION_DIR.match(name) else None


def workshop_base_url(raw: Optional[str], mission: Optional[str] = None) -> str:
    """WORKSHOP_URL (the `wss://<host>/sdk` the /code page shows) plus the
    mission folder. The SDK adds /v1/agent/converse, and the proxy logs the
    conversation under that mission on your map."""
    url = (raw or "").strip().rstrip("/")
    if not url:
        raise SetupError("WORKSHOP_TOKEN is set but WORKSHOP_URL is empty. Copy both lines from the workshop's /code page into .env.")
    if url.startswith("https://"):
        url = "wss://" + url[len("https://") :]
    elif url.startswith("http://"):
        url = "ws://" + url[len("http://") :]
    if url.endswith(AGENT_PATH):
        url = url[: -len(AGENT_PATH)]
    if not url.startswith(("ws://", "wss://")):
        raise SetupError("WORKSHOP_URL must start with wss://. Copy it again from the workshop's /code page.")
    if not valid_address(url):
        raise SetupError(BAD_WORKSHOP_URL)
    if not url.endswith("/sdk"):
        # The site's own address (no /sdk) reaches no proxy, which reads like a closed one.
        raise SetupError(f"WORKSHOP_URL should end in /sdk. Copy both lines from {code_page()} into .env.")
    return f"{url}/{mission}" if mission else url


def _env(name: str) -> str:
    return os.environ.get(name, "").strip()


def token_wins() -> bool:
    """True when WORKSHOP_TOKEN and WORKSHOP_URL are both set and DEEPGRAM_AGENT_URL is
    not: the run uses the workshop token, even with a DEEPGRAM_API_KEY in the shell
    (one exported for your own STT work, say). Leave WORKSHOP_TOKEN empty to use your key."""
    return bool(_env("WORKSHOP_TOKEN") and _env("WORKSHOP_URL") and not _env("DEEPGRAM_AGENT_URL"))


def uses_workshop(url: Optional[str] = None, api_key: Optional[str] = None) -> bool:
    """True when this run goes through the workshop proxy, as in make_client: WORKSHOP_TOKEN
    set, no explicit `api_key` or `url`, no DEEPGRAM_AGENT_URL, and either WORKSHOP_URL set
    (the token wins) or no DEEPGRAM_API_KEY."""
    if api_key or url or _env("DEEPGRAM_AGENT_URL") or not _env("WORKSHOP_TOKEN"):
        return False
    return token_wins() or not _env("DEEPGRAM_API_KEY")


# The listen model. nova-3 (v1) runs on every Deepgram project, and it's the model
# the Voice Agent docs show. The workshop site runs flux-general-en (v2), Deepgram's
# conversational listener with turn detection built in, and the workshop proxy only
# accepts that one. Set LISTEN_MODEL=flux-general-en and LISTEN_VERSION=v2 in .env to
# match the site on your own key.
DEFAULT_LISTEN_MODEL = "nova-3"
DEFAULT_LISTEN_VERSION = "v1"
WORKSHOP_LISTEN_MODEL = "flux-general-en"
WORKSHOP_LISTEN_VERSION = "v2"


def listen_provider() -> dict:
    """The `agent.listen.provider` block for missions that don't pick their own.

    LISTEN_MODEL and LISTEN_VERSION override it. With a workshop token and no
    override, it asks for the proxy's model, so no listen Warning comes back."""
    model = os.environ.get("LISTEN_MODEL", "").strip()
    version = os.environ.get("LISTEN_VERSION", "").strip()
    if not model:
        workshop = uses_workshop()
        model = WORKSHOP_LISTEN_MODEL if workshop else DEFAULT_LISTEN_MODEL
        version = version or (WORKSHOP_LISTEN_VERSION if workshop else DEFAULT_LISTEN_VERSION)
    provider = {"type": "deepgram", "model": model}
    if version:
        provider["version"] = version
    return provider


def workshop_site() -> Optional[str]:
    """The workshop site's address (https://<host>/<path>), read from WORKSHOP_URL without
    its /sdk (and anything after it) or a pasted page's /code, /resume or /m/<mission>, or
    None. A ws:// or http:// WORKSHOP_URL (a local server) keeps http://."""
    m = re.match(r"^(wss|ws|https|http)://([^/\s?#]+(?:/[^\s?#]*)?)", os.environ.get("WORKSHOP_URL", "").strip())
    if not m:
        return None
    scheme = "http" if m.group(1) in ("ws", "http") else "https"
    return f"{scheme}://" + re.sub(r"/(?:m/.*|code|resume)$", "", re.sub(r"/sdk(?:/.*)?$", "", m.group(2).rstrip("/")))


def code_page() -> str:
    """Where to get a workshop token: the site's /code page, by address when we know it."""
    site = workshop_site()
    return f"{site}/code" if site else "the workshop site's /code page"


# With no .env at all (make setup creates one): the same line as common.ts and Credentials.java.
# README "Troubleshooting" keys on the first words of both lines.
NO_CREDENTIALS = (
    "No Deepgram credentials. Copy .env.example to .env and set DEEPGRAM_API_KEY "
    "(free key: https://console.deepgram.com/signup), or paste WORKSHOP_URL and WORKSHOP_TOKEN from the workshop's /code page."
)


def dotenv_exists() -> bool:
    """True when the project's .env is there to edit (and python-dotenv reads it)."""
    return not _dotenv_disabled() and (PROJECT_ROOT / ".env").is_file()


def no_credentials_line(mission: Optional[str] = None, has_env: Optional[bool] = None) -> str:
    """The line for a run with neither a key nor a token, by whether .env exists: the
    file `make setup` created with an empty key is the usual case, so that one says
    "empty", never "copy". `mission` (the folder) fills in the mission number; `has_env`
    (tests) stands in for the file check."""
    nn = mission[:2] if mission else "NN"
    if dotenv_exists() if has_env is None else has_env:
        # "this folder": the project folder, where make runs (the README says so, next to this line).
        return (
            "DEEPGRAM_API_KEY is empty in .env (this folder). Set it, or paste WORKSHOP_URL and WORKSHOP_TOKEN "
            f"from the workshop's /code page. make check {nn} runs offline with no key."
        )
    return NO_CREDENTIALS


def credentials_problem(api_key: Optional[str] = None, mission: Optional[str] = None) -> Optional[str]:
    """The no-credentials line when there is neither a key (`api_key` or DEEPGRAM_API_KEY)
    nor a WORKSHOP_TOKEN, else None. Checks only whether they are set, never their values."""
    key = api_key or os.environ.get("DEEPGRAM_API_KEY", "").strip()
    token = os.environ.get("WORKSHOP_TOKEN", "").strip()
    return None if key or token else no_credentials_line(mission)


def printable(value: str) -> bool:
    """True when every character is printable ASCII (0x21 to 0x7E): no spaces, no curly quotes."""
    return all(0x21 <= ord(c) <= 0x7E for c in value)


def bad_character(name: str, what: str) -> str:
    """The line for a key or token with a character it can't have. Never prints the value."""
    return (f"{name} has a character {what} can't have (a curly quote or a hidden space, "
            "often from copy and paste). Copy it again as plain text.")


def credentials_note() -> Optional[str]:
    """One line saying which credential this run uses, when DEEPGRAM_API_KEY and
    WORKSHOP_TOKEN are both set (a key exported in the shell or a Codespaces secret sets
    one without .env saying so). Never prints either value."""
    if not (_env("DEEPGRAM_API_KEY") and _env("WORKSHOP_TOKEN")):
        return None
    if token_wins():
        return (
            "[credentials] Using your workshop token (the proxy); your DEEPGRAM_API_KEY is set too "
            "and waits for after the event. To run on it now, leave WORKSHOP_TOKEN empty."
        )
    why = "DEEPGRAM_AGENT_URL is set" if _env("DEEPGRAM_AGENT_URL") else "WORKSHOP_URL is empty"
    return f"[credentials] Using your DEEPGRAM_API_KEY; your workshop token is not used because {why}."


def make_client(url: Optional[str] = None, api_key: Optional[str] = None, mission: Optional[str] = None) -> AsyncDeepgramClient:
    """An SDK client pointed at the right agent host with the right credentials.

    Order: an explicit api_key; then the workshop token when WORKSHOP_TOKEN and
    WORKSHOP_URL are both set (sent as a bearer token, see token_wins); then
    DEEPGRAM_API_KEY; then WORKSHOP_TOKEN. Through the proxy, `mission` (the
    mission folder) picks where your conversation counts. An explicit `url` (the
    local check harness) gets the same credential; the harness relays it on.
    """
    token = _env("WORKSHOP_TOKEN")
    key = api_key or ("" if token_wins() else _env("DEEPGRAM_API_KEY"))
    if not key and token and not url and _env("DEEPGRAM_AGENT_URL"):
        # The workshop token belongs to the workshop proxy only. (An explicit `url` is
        # the local check harness, which relays to the proxy itself.)
        raise SetupError("DEEPGRAM_AGENT_URL needs your own DEEPGRAM_API_KEY. With a workshop token, leave DEEPGRAM_AGENT_URL empty: the workshop proxy picks the endpoint.")
    if uses_workshop(url, api_key):
        # A workshop token and no agent URL: go through the workshop proxy.
        base = workshop_base_url(os.environ.get("WORKSHOP_URL"), mission)
    else:
        base = agent_base_url(url or os.environ.get("DEEPGRAM_AGENT_URL"))
    problem = credentials_problem(api_key, mission)
    if problem:
        raise SetupError(problem)
    # Printable ASCII only: a header can't carry a curly quote, and a space is a paste error.
    if key and not printable(key):
        raise SetupError(bad_character("DEEPGRAM_API_KEY", "a key"))
    if not key and not printable(token):
        raise SetupError(bad_character("WORKSHOP_TOKEN", "a token"))
    rest = base.replace("wss://", "https://", 1).replace("ws://", "http://", 1)
    environment = DeepgramClientEnvironment(
        base="https://api.deepgram.com",
        production="wss://api.deepgram.com",
        agent=base,
        agent_rest=rest,
    )
    if key:
        return AsyncDeepgramClient(api_key=key, environment=environment)
    return AsyncDeepgramClient(access_token=token, environment=environment)


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------


def to_dict(message: Any) -> Event:
    """SDK message -> plain dict shaped like the wire JSON.

    Known events arrive as SDK models; event types newer than the SDK arrive as
    dicts already. Fields the SDK doesn't model (for example
    `conversational_behavior` on ConversationText) are kept either way."""
    if isinstance(message, dict):
        return message
    if isinstance(message, pydantic.BaseModel):
        return message.dict()
    return {"type": getattr(message, "type", None)}


# ---------------------------------------------------------------------------
# The agent handle missions get
# ---------------------------------------------------------------------------


class Agent:
    """One live conversation. Missions call these; each one sends one message."""

    def __init__(self, socket: Any, *, quiet: bool = False):
        self._socket = socket
        self._quiet = quiet
        self._raw_notice_shown: set[str] = set()
        self.ready = asyncio.Event()  # set when SettingsApplied arrives
        self.closed = False
        self.hung_up = False  # True when your program called close()
        self.close_code: Optional[int] = None  # how the server closed the call, when it did
        self.close_reason = ""
        self.stop_code: Optional[str] = None  # a STOP_CODES code from an Error or Warning, if one came
        self.stop_type: Optional[str] = None  # "Error" or "Warning": which frame carried stop_code
        # Piped turns: which agent turn run() is waiting on. None: none; "greeting": the
        # greeting's audio; "sent": a piped line, no reply yet; "spoken": its reply came,
        # its audio is still going. reply_done is set when that turn's AgentAudioDone arrives.
        self.turn: Optional[str] = None
        self.reply_done = asyncio.Event()
        # A piped turn with a function call ("calling"): the client-side calls still waiting
        # for your FunctionCallResponse, and the lines you injected meanwhile (a filler). The
        # turn moves on to "spoken" with the agent's first other line after your answers, so
        # a filler's AgentAudioDone never ends it, even when on_event held the loop.
        self.calls_open = 0
        self.injected: list[str] = []
        self.settings: Optional[dict] = None  # the Settings you sent, as JSON
        self._in_on_event = False  # run() sets this while your on_event runs

    # -- the one escape hatch -------------------------------------------------

    async def send_raw(self, message: dict) -> None:
        """Send any JSON message as is. Use it for fields or values the SDK doesn't model.

        deepgram-sdk 7.12 sends raw JSON through its private `_send`, so this
        calls that. When the SDK has a public send_raw, this calls it instead.
        The only other private touchpoint is in close_sdk_socket() below, used
        only when close() runs outside on_event."""
        public = getattr(self._socket, "send_raw", None)
        if callable(public):
            await public(message)
        else:
            await self._socket._send(message)

    async def _send_typed(self, model: type[pydantic.BaseModel], payload: dict, send: Callable[[Any], Awaitable[None]]) -> None:
        """Validate through the SDK's model and send it. If this SDK release can't
        model part of the message (a provider type newer than the SDK, say), send
        the same JSON raw instead of failing."""
        try:
            typed = model(**payload)
        except pydantic.ValidationError:
            kind = payload.get("type", model.__name__)
            if kind not in self._raw_notice_shown and not self._quiet:
                print(f"[note] {kind} sent as raw JSON: this SDK release has no field for part of it (the check reads it the same)")
            self._raw_notice_shown.add(kind)
            await self.send_raw(payload)
            return
        await send(typed)

    # -- senders ---------------------------------------------------------------

    async def send_settings(self, settings: dict) -> None:
        settings = {"type": "Settings", **settings}
        self.settings = settings
        await self._send_typed(AgentV1Settings, settings, self._socket.send_settings)

    async def update_prompt(self, prompt: str) -> None:
        await self._send_typed(AgentV1UpdatePrompt, {"type": "UpdatePrompt", "prompt": prompt}, self._socket.send_update_prompt)

    async def update_speak(self, speak: dict) -> None:
        await self._send_typed(AgentV1UpdateSpeak, {"type": "UpdateSpeak", "speak": speak}, self._socket.send_update_speak)

    async def update_think(self, think: dict) -> None:
        """Swap the think block mid-call (provider, prompt, functions). A provider newer
        than the SDK goes out raw, with a one-line note."""
        await self._send_typed(AgentV1UpdateThink, {"type": "UpdateThink", "think": think}, self._socket.send_update_think)

    async def inject_agent_message(self, message: str, behavior: Optional[str] = None) -> None:
        payload: dict = {"type": "InjectAgentMessage", "message": message}
        self.injected.append(message.strip())
        if behavior:
            payload["behavior"] = behavior
        await self._send_typed(AgentV1InjectAgentMessage, payload, self._socket.send_inject_agent_message)

    async def inject_user_message(self, content: str) -> None:
        await self._send_typed(AgentV1InjectUserMessage, {"type": "InjectUserMessage", "content": content}, self._socket.send_inject_user_message)

    async def function_call_response(self, id: str, name: str, content: str) -> None:
        payload = {"type": "FunctionCallResponse", "id": id, "name": name, "content": content}
        self.calls_open = max(0, self.calls_open - 1)
        await self._send_typed(AgentV1SendFunctionCallResponse, payload, self._socket.send_function_call_response)

    async def keep_alive(self) -> None:
        await self._socket.send_keep_alive()

    async def send_audio(self, chunk: bytes) -> None:
        await self._socket.send_media(chunk)

    async def close(self) -> None:
        """Hang up. The conversation loop in run() ends right after.

        From on_event (where every mission calls it) this only marks the call
        closed: run() leaves its loop when on_event returns, and leaving the
        SDK's `async with connect()` closes the socket. From anywhere else (a
        task of your own, for example), nothing would wake that loop, so this closes the
        socket itself, through close_sdk_socket()."""
        if self.closed:
            return
        self.closed = True
        self.hung_up = True
        if not self._in_on_event:
            await close_sdk_socket(self._socket)


async def close_sdk_socket(socket: Any) -> None:
    """Close the SDK's agent socket from outside the receive loop.

    Uses the socket's public `close()` when the SDK has one. TEMPORARY WORKAROUND
    for the pinned deepgram-sdk 7.12.0, whose async agent socket has no public
    close: it closes the private `_websocket` underneath. This is the only place
    the project touches `_websocket`; drop the fallback once the pin moves to a
    release with a public close (test_common.py pins this behaviour)."""
    public = getattr(socket, "close", None)
    if callable(public):
        await public()
        return
    await socket._websocket.close()  # deepgram-sdk 7.12.0 only; see the docstring


# ---------------------------------------------------------------------------
# Audio: save the agent's voice, and optionally use your mic and speakers
# ---------------------------------------------------------------------------


class WavSink:
    """Collects the agent's linear16 audio and writes one WAV file at the end."""

    def __init__(self, path: Path, sample_rate: int = 24000):
        self.path = path
        self.sample_rate = sample_rate
        self.chunks: list[bytes] = []

    def write(self, chunk: bytes) -> None:
        self.chunks.append(chunk)

    def close(self) -> Optional[Path]:
        if not self.chunks:
            return None
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with wave.open(str(self.path), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(self.sample_rate)
            w.writeframes(b"".join(self.chunks))
        return self.path


NO_AUDIO_DEVICE = "No microphone or speakers found here; type your turns instead (drop MIC=1)."
# Linux only: the sounddevice wheels for macOS and Windows bring PortAudio with them.
NO_PORTAUDIO = (
    "MIC=1 uses the PortAudio library: `sudo apt install libportaudio2` (Ubuntu, Debian) "
    "or `sudo dnf install portaudio` (Fedora) adds it, or type your turns instead (drop MIC=1)."
)


def _no_host_audio() -> bool:
    """Codespaces, WSL, Docker or Podman: no audio device, so installing PortAudio wouldn't
    help. A Fedora toolbox or a distrobox (both write /run/.toolboxenv) shares the host's
    audio, so PortAudio is the fix there."""
    if os.path.exists("/run/.toolboxenv"):
        return False
    if os.environ.get("CODESPACES") or os.environ.get("WSL_DISTRO_NAME"):
        return True
    return os.path.exists("/.dockerenv") or os.path.exists("/run/.containerenv")


class MicAndSpeaker:
    """Streams your microphone to the agent and plays its voice. Needs
    `uv sync --extra mic`. Use headphones, or the agent hears itself.
    If your microphone or speakers misbehave, type your turns instead.

    The streams open here, before the call connects, so a machine with no audio
    device (Codespaces, a container, SSH) stops with one line, not a traceback.
    Audio flows once `attach(agent)` and `start()` run, after SettingsApplied."""

    def __init__(self, loop: asyncio.AbstractEventLoop, in_rate: int = 16000, out_rate: int = 24000):
        try:
            import sounddevice as sd  # type: ignore[import-untyped]
        except ImportError as exc:
            raise SetupError("--mic needs the optional audio extra: run `uv sync --extra mic` first") from exc
        except OSError:
            # sounddevice is installed but the PortAudio library isn't ("PortAudio library not found").
            # In a container or WSL there's no device to find, so the fix is to type your turns.
            raise SetupError(NO_AUDIO_DEVICE if _no_host_audio() else NO_PORTAUDIO) from None

        self._agent: Optional[Agent] = None
        self._loop = loop
        self.started = False
        try:
            self._in = sd.RawInputStream(samplerate=in_rate, channels=1, dtype="int16", blocksize=in_rate // 50, callback=self._on_mic)
            self._out = sd.RawOutputStream(samplerate=out_rate, channels=1, dtype="int16")
        except sd.PortAudioError:
            raise SetupError(NO_AUDIO_DEVICE) from None

    def attach(self, agent: Agent) -> None:
        self._agent = agent

    def _on_mic(self, data, _frames, _time, _status) -> None:
        agent = self._agent
        if agent and agent.ready.is_set() and not agent.closed:
            asyncio.run_coroutine_threadsafe(agent.send_audio(bytes(data)), self._loop)

    def start(self) -> None:
        import sounddevice as sd  # type: ignore[import-untyped]

        try:
            self._in.start()
            self._out.start()
        except sd.PortAudioError:
            raise SetupError(NO_AUDIO_DEVICE) from None
        self.started = True

    def play(self, chunk: bytes) -> None:
        self._out.write(chunk)

    def stop(self) -> None:
        for stream in (self._in, self._out):
            try:
                stream.stop()
                stream.close()
            except Exception:  # a stream that never started, or a device that went away
                pass


# ---------------------------------------------------------------------------
# The conversation loop
# ---------------------------------------------------------------------------


class _TypedLines:
    """Reads stdin on one background thread for the whole program and hands each
    line to the conversation running now, so a reconnect never loses a line."""

    def __init__(self) -> None:
        self._started = False
        self._target: Optional[tuple[asyncio.AbstractEventLoop, asyncio.Queue]] = None

    def attach(self, loop: asyncio.AbstractEventLoop, queue: asyncio.Queue) -> None:
        self._target = (loop, queue)
        if not self._started:
            self._started = True
            threading.Thread(target=self._read, daemon=True).start()

    def detach(self) -> None:
        self._target = None

    def _send(self, line: Optional[str]) -> None:
        target = self._target
        if target:
            loop, queue = target
            try:
                loop.call_soon_threadsafe(queue.put_nowait, line)
            except RuntimeError:
                pass  # that conversation's loop has already closed

    def _read(self) -> None:
        for line in sys.stdin:
            if line.strip():
                self._send(line.strip())
        self._send(None)


_typed_lines = _TypedLines()


SETTINGS_REFUSED_HINT = (
    "The agent didn't accept part of your Settings. If this mission uses a feature your "
    "Deepgram project can't use (01 and 02 use `timing`), finish it with the offline check "
    "(make check and the mission number), or run it on a project that has the feature. "
    "On event day, a workshop token works too (WORKSHOP_URL and WORKSHOP_TOKEN in .env)."
)


# The agent's Error when the Deepgram project already runs as many `thinking` conversations
# at once as it may. Through the workshop proxy, that's the workshop's project.
CONCURRENCY_LIMIT_REACHED = "CONCURRENCY_LIMIT_REACHED"
THINKING_BUSY_HINT = (
    "The `thinking` model is busy: this Deepgram project (the workshop's, with a token) already "
    "runs as many `thinking` conversations at once as it may. Wait a minute and run your program "
    "again, or leave THINKING_MODEL empty in .env to keep going with the usual model."
)

# A Warning the `thinking` model's endpoint sends on every Settings: it put its own voice style
# instructions ahead of your prompt. Expected, so it prints as a note, not a warning.
VOICE_PROMPT_ADDED = "VOICE_PROMPT_ADDED"
VOICE_PROMPT_NOTE = (
    "[note] The `thinking` model put its own voice style instructions ahead of your prompt. "
    "That's expected; nothing to change. (VOICE_PROMPT_ADDED)"
)


def token_refused_hint() -> str:
    """HTTP 401 through the workshop proxy: the proxy is open, but this token isn't valid."""
    return (
        "Check WORKSHOP_TOKEN: it expired, was replaced, or was turned off by workshop staff. "
        f"Get a new one on {code_page()}."
    )


# HTTP 404 through the workshop proxy: the token route itself is gone. The proxy runs
# on event day only, so after the event every token gets this, not a 401.
PROXY_CLOSED_HINT = (
    "The workshop proxy is closed: it runs on event day only. Put your own DEEPGRAM_API_KEY "
    "in .env (free key: https://console.deepgram.com/signup) and leave WORKSHOP_TOKEN empty. "
    "Missions 01 and 02 use the `timing` feature: finish them with the offline check "
    "(make check 01), or on a Deepgram project that has the `timing` feature."
)


# The workshop proxy refuses a session it can't run with one Error before Welcome, then
# closes 1013. The description says what to do; these are the same words, for a frame
# that comes without one. A staff pause mid-run is a TALK_PAUSED Warning, then close 1000.
TALK_UNCONFIGURED = "TALK_UNCONFIGURED"
TALK_PAUSED = "TALK_PAUSED"
ONLINE_FULL = "ONLINE_FULL"
LIVE_CLOSED = "LIVE_CLOSED"
TALK_MESSAGES = {
    TALK_UNCONFIGURED: (
        "The workshop's live agent opens soon. Run your program again once it does, or set "
        "DEEPGRAM_API_KEY in .env and leave WORKSHOP_TOKEN empty to run on your own key now."
    ),
    TALK_PAUSED: "Workshop staff paused the live agent for a minute. Run your program again shortly.",
    ONLINE_FULL: "The live agent's online seats are all taken right now. Wait a few minutes, then run your program again.",
    LIVE_CLOSED: (
        "The workshop's live agent has closed. Your program runs on your own key now: set "
        "DEEPGRAM_API_KEY and leave WORKSHOP_TOKEN empty."
    ),
}
REFUSAL_CODES = frozenset(TALK_MESSAGES)

# Codes after which reconnecting can't help: the workshop stopped this token or session
# on purpose. run_resilient stops on them (see docs/troubleshooting.md).
STOP_CODES = REFUSAL_CODES | frozenset({
    "TOKEN_REPLACED", "TOKEN_EXPIRED", "TOKEN_REVOKED", "SESSION_REPLACED",
    "SESSION_RESUMED", "SESSION_CLOSED_BY_STAFF", "SESSION_LIFETIME",
})


def workshop_line(event: Event) -> str:
    """The one line for a refusal or a pause: the proxy's own words and the code."""
    code = str(event.get("code"))
    text = event.get("description") or event.get("message") or TALK_MESSAGES.get(code, "")
    return f"[workshop] {text} ({code})"


def refused_line(status: Optional[int], workshop: bool) -> str:
    """One line for an HTTP refusal of the connection, with its fix."""
    hint = ""
    if status == 401:
        hint = f" {token_refused_hint()}" if workshop else " Check DEEPGRAM_API_KEY."
    elif status == 404 and workshop:
        hint = f" {PROXY_CLOSED_HINT}"
    who = "The workshop proxy" if workshop else "Deepgram"
    return f"{who} refused the connection (HTTP {status}).{hint}"


def unreachable_line(err: OSError, workshop: bool) -> str:
    """One line for a connection that never opened (nothing listening, a bad host).
    asyncio joins one error per address it tried ("Multiple exceptions: ..."), so a
    refusal is read from the errno or the text, never printed raw."""
    var = "WORKSHOP_URL" if workshop else "DEEPGRAM_AGENT_URL"
    text = str(err)
    if isinstance(err, ConnectionRefusedError) or "Errno 61" in text or "Errno 111" in text or "Connect call failed" in text:
        return f"Could not reach the agent: connection refused. Check {var}." + (" Is the workshop site up?" if workshop else "")
    detail = redact(str(err.strerror or "")) or type(err).__name__
    return f"Could not reach the agent: {detail}. Check {var}."


def retryable_status(status: Optional[int]) -> bool:
    """429 (busy) and 5xx (a server problem) can pass on a later try; other refusals can't."""
    return status is not None and (status == 429 or status >= 500)


def explain_error(event: Event) -> str:
    """One readable line for an Error event, with a fix where we know one."""
    code = event.get("code") or "no code"
    text = event.get("description") or event.get("message") or ""
    line = f"Agent error: {text} ({code})"
    if code in STOP_CODES:
        return workshop_line(event)
    if code == "UNPARSABLE_CLIENT_MESSAGE":
        line += f"\n  {SETTINGS_REFUSED_HINT}"
    elif code == CONCURRENCY_LIMIT_REACHED:
        line += f"\n  {THINKING_BUSY_HINT}"
    return line


def explain_warning(event: Event) -> str:
    """One readable line for a Warning event, with its code when it has one
    (TOKEN_REPLACED, SESSION_RESUMED, AUDIO_DROPPED, FEATURE_OFF: see docs/troubleshooting.md).
    VOICE_PROMPT_ADDED is expected with `thinking`: a note."""
    code = event.get("code")
    if code == VOICE_PROMPT_ADDED:
        return VOICE_PROMPT_NOTE
    if code in STOP_CODES:
        # The workshop stopped this token or session (a pause, a new token, a resume): its own line.
        return workshop_line(event)
    text = event.get("description") or event.get("message") or ""
    return f"Agent warning: {text} ({code})" if code else f"Agent warning: {text}"


# In an offline check every agent frame is a recording: an Error there is part of the
# scenario, sent on purpose to see how your program handles it.
REPLAY_ERROR_NOTE = "  [replay] The check sends this error on purpose, to see how your program handles it."


# What the ready line says about typed turns, by where they come from (see input_mode).
READY_HINTS = {
    "tty": " Type a line and press Enter to talk. Ctrl-D or Ctrl-C hangs up.",
    "piped": " Reading your lines from the input; it hangs up after the reply to the last one.",
    None: "",
}


def input_mode() -> str:
    """Where typed turns come from: "tty" (you type them) or "piped" (`echo hi | make run 00`,
    or a file). Piped lines go one at a time, each after the reply to the one before."""
    return "tty" if sys.stdin.isatty() else "piped"


def event_line(event: Event, replay: bool = False, typing: Optional[str] = "tty") -> Optional[str]:
    """What run() prints for an event, or None. `replay` marks lines from an offline check;
    `typing` is the input mode the ready line describes (None: no typed turns)."""
    kind = event.get("type")
    line: Optional[str] = None
    if kind == "ConversationText":
        if str(event.get("content") or "").strip():  # an empty line (no greeting set, say) says nothing
            line = f"{event.get('role')}: {event.get('content')}"
    elif kind == "Error":
        line = explain_error(event) + (f"\n{REPLAY_ERROR_NOTE}" if replay else "")
    elif kind == "Warning":
        line = explain_warning(event)
    elif kind == "SettingsApplied":
        line = "[ready] the agent has your settings." + ("" if replay else READY_HINTS.get(typing, ""))
    if line is not None and replay:
        line = "[replay] " + line
    return line


def _print_event(event: Event, replay: bool = False, typing: Optional[str] = None) -> None:
    line = event_line(event, replay, typing)
    if line is not None:
        print(line)


async def run_async(
    build_settings: BuildSettings,
    on_event: Optional[OnEvent] = None,
    *,
    url: Optional[str] = None,
    api_key: Optional[str] = None,
    interactive: Optional[bool] = None,
    save_audio: Optional[Path] = None,
    mic: bool = False,
    quiet: bool = False,
    mission: Optional[str] = None,
    replay: bool = False,
) -> Agent:
    """Connect, send Settings when the server says Welcome, and hand every event
    to `on_event` until the connection closes. Returns the Agent for inspection.

    `interactive` (default: on) reads typed turns from stdin, from a terminal or a pipe;
    the end of the input hangs up. False turns typed turns off (the checks do)."""
    load_env()
    client = make_client(url, api_key, mission)
    typing = None if interactive is False else input_mode()
    interactive = typing is not None
    loop = asyncio.get_running_loop()
    sink = WavSink(save_audio) if save_audio else None
    tasks: list[asyncio.Task] = []
    # The mic opens before the call does, so a machine with no audio device stops here.
    audio_io: Optional[MicAndSpeaker] = MicAndSpeaker(loop) if mic else None
    said_bye = False  # a [bye] line is out already (the end of input)
    applied = False  # the agent took your Settings: a call happened

    try:
        async with client.agent.v1.connect() as socket:
            agent = Agent(socket, quiet=quiet)

            async def keep_alive() -> None:
                # No audio flows unless you use --mic, so KeepAlive holds the connection open.
                while not agent.closed:
                    await asyncio.sleep(KEEPALIVE_SECONDS)
                    if agent.ready.is_set() and not agent.closed and not (audio_io and audio_io.started):
                        await agent.keep_alive()

            async def wait_for_turn() -> None:
                # The agent turn in flight (the greeting, or the reply to a piped line) ends on
                # its own AgentAudioDone, or after PIPED_REPLY_SECONDS.
                if agent.turn is None:
                    return
                try:
                    await asyncio.wait_for(agent.reply_done.wait(), PIPED_REPLY_SECONDS)
                except asyncio.TimeoutError:
                    pass
                agent.turn = None

            async def typed_turns(queue: asyncio.Queue) -> None:
                nonlocal said_bye
                while True:
                    line = await queue.get()
                    await agent.ready.wait()
                    if typing == "piped":
                        await wait_for_turn()  # the greeting first, then each reply
                    if agent.closed:
                        return
                    try:
                        if line is None:
                            # End of input (Ctrl-D, or the last piped line answered): hang up.
                            if not quiet:
                                print("[bye] end of input, hanging up.")
                            said_bye = True
                            await agent.close()
                            return
                        if typing == "piped":
                            # One piped line at a time: the next waits for this one's reply.
                            agent.reply_done.clear()
                            agent.turn = "sent"
                            agent.calls_open = 0
                            agent.injected = []
                        await agent.inject_user_message(line)
                    except websockets.exceptions.ConnectionClosed:
                        return  # the server closed first (a pause, say): nothing left to send

            tasks.append(asyncio.create_task(keep_alive()))
            if interactive:
                queue: asyncio.Queue = asyncio.Queue()
                _typed_lines.attach(loop, queue)
                tasks.append(asyncio.create_task(typed_turns(queue)))

            try:
                async for message in socket:
                    if isinstance(message, bytes):
                        if sink:
                            sink.write(message)
                        if audio_io and audio_io.started:
                            audio_io.play(message)
                        continue
                    event = to_dict(message)
                    kind = event.get("type")
                    if kind in ("Error", "Warning") and event.get("code") in STOP_CODES:
                        agent.stop_code = event.get("code")
                        agent.stop_type = kind
                    elif kind == "ConversationText" and event.get("role") == "assistant" and (
                        agent.turn == "sent"
                        or (agent.turn == "calling" and not agent.calls_open and str(event.get("content") or "").strip() not in agent.injected)
                    ):
                        agent.turn = "spoken"  # this line's reply; its AgentAudioDone ends the turn
                    elif kind == "FunctionCallRequest" and agent.turn in ("sent", "spoken", "calling"):
                        # The turn ends on the reply after your answer, not on a filler's audio.
                        calls = sum(1 for f in event.get("functions") or [] if f.get("client_side", True))
                        if calls:
                            agent.calls_open += calls
                            agent.turn = "calling"
                    elif kind == "AgentAudioDone" and agent.turn in ("greeting", "spoken"):
                        agent.reply_done.set()
                    if kind == "Welcome":
                        settings = build_settings()
                        if sink:
                            sink.sample_rate = int(((settings.get("audio") or {}).get("output") or {}).get("sample_rate") or 24000)
                        if typing == "piped" and ((settings.get("agent") or {}).get("greeting") or "").strip():
                            # The greeting plays first: the first piped line waits for it to finish.
                            agent.reply_done.clear()
                            agent.turn = "greeting"
                        await agent.send_settings(settings)
                    elif kind == "SettingsApplied":
                        agent.ready.set()
                        applied = True
                        if audio_io and not audio_io.started:
                            audio_io.attach(agent)
                            audio_io.start()
                    if not quiet:
                        _print_event(event, replay, typing)
                    if on_event:
                        agent._in_on_event = True
                        try:
                            await on_event(agent, event)
                        finally:
                            agent._in_on_event = False
                    if agent.closed:
                        # Your program hung up (end_call answered, say): one closing line, so
                        # the run doesn't look like it stopped on its own.
                        if agent.hung_up and not said_bye and not quiet and not replay:
                            print(HUNG_UP_LINE)
                        break  # leaving `async with` closes the socket
            except websockets.exceptions.ConnectionClosed as closed:
                # No close frame at all (the network dropped) reads as 1006, as in a browser.
                agent.close_code = closed.rcvd.code if closed.rcvd else 1006
                agent.close_reason = closed.rcvd.reason if closed.rcvd else "no close frame"
                # A stop code already printed its line; the close after it says nothing new.
                if not quiet and agent.close_code != 1000 and agent.stop_code is None:
                    print(f"[closed] {agent.close_code} {agent.close_reason}".rstrip())
            agent.closed = True
            return agent
    except ApiError as err:
        # Never print the exception itself: it carries the request headers, key included.
        raise SetupError(refused_line(err.status_code, uses_workshop(url, api_key)), retryable=retryable_status(err.status_code)) from None
    except OSError as err:
        raise SetupError(unreachable_line(err, uses_workshop(url, api_key)), retryable=True) from None
    finally:
        if interactive:
            _typed_lines.detach()
        for task in tasks:
            task.cancel()
        if audio_io:
            audio_io.stop()
        if sink:
            saved = sink.close()
            if saved and not quiet:
                print(f"[saved] the agent's voice is in {saved.relative_to(PROJECT_ROOT) if saved.is_relative_to(PROJECT_ROOT) else saved}")
            elif applied and not quiet:
                print(NO_AUDIO_LINE)


def run(build_settings: BuildSettings, on_event: Optional[OnEvent] = None) -> None:
    """Entry point for `uv run python missions/NN-name/start.py [--mic] [--no-save]`."""
    parser = argparse.ArgumentParser(description="Talk to your agent. Type a line and press Enter.")
    parser.add_argument("--mic", action="store_true", help="use your microphone and speakers (uv sync --extra mic)")
    parser.add_argument("--no-save", action="store_true", help="don't save the agent's voice to out/last-call.wav")
    args = parser.parse_args()
    save = None if args.no_save else PROJECT_ROOT / "out" / "last-call.wav"
    load_env()
    note = credentials_note()
    if note:
        print(note)
    try:
        mission = mission_of(getattr(build_settings, "__code__", None) and build_settings.__code__.co_filename)
        agent = asyncio.run(run_async(build_settings, on_event, save_audio=save, mic=args.mic, mission=mission))
    except SetupError as err:
        print(err, file=sys.stderr)
        sys.exit(2)
    except KeyboardInterrupt:
        print("\n[bye]")
        return
    except Exception as err:
        print_crash(err)
        sys.exit(1)
    sys.exit(exit_status(agent))


def exit_status(agent: Agent) -> int:
    """The program's exit status: 1 when the workshop refused the session (an Error with
    TALK_UNCONFIGURED, TALK_PAUSED, ONLINE_FULL or LIVE_CLOSED), else 0. A staff pause
    mid-run (a TALK_PAUSED Warning) ends the run cleanly, with 0."""
    return 1 if agent.stop_type == "Error" and agent.stop_code in REFUSAL_CODES else 0
