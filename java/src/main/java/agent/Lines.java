package agent;

import java.net.ConnectException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.util.Map;
import java.util.Set;

/** Every line a run prints about the agent, the workshop and errors: each one in one place. */
public final class Lines {
    private Lines() {}

    public static final String HUNG_UP_LINE = "[bye] your program hung up.";
    public static final String END_OF_INPUT_LINE = "[bye] end of input, hanging up.";
    public static final String NO_AUDIO_LINE =
            "[no audio] The agent sent no audio on this call, so there is no new out/last-call.wav.";

    public static final String SETTINGS_REFUSED_HINT =
            "The agent didn't accept part of your Settings. If this mission uses a feature your "
                    + "Deepgram project can't use (01 and 02 use `timing`), finish it with the offline check "
                    + "(make check and the mission number), or run it on a project that has the feature. "
                    + "On event day, a workshop token works too (WORKSHOP_URL and WORKSHOP_TOKEN in .env).";

    /**
     * The agent's Error when the project already runs as many `thinking` conversations at once
     * as it may.
     */
    public static final String CONCURRENCY_LIMIT_REACHED = "CONCURRENCY_LIMIT_REACHED";

    public static final String THINKING_BUSY_HINT =
            "The `thinking` model is busy: this Deepgram project (the workshop's, with a token) already "
                    + "runs as many `thinking` conversations at once as it may. Wait a minute and run your program "
                    + "again, or leave THINKING_MODEL empty in .env to keep going with the usual model.";

    /**
     * A Warning the `thinking` endpoint sends on every Settings: expected, so it prints as a note.
     */
    public static final String VOICE_PROMPT_ADDED = "VOICE_PROMPT_ADDED";

    public static final String VOICE_PROMPT_NOTE =
            "[note] The `thinking` model put its own voice style instructions ahead of your prompt. "
                    + "That's expected; nothing to change. (VOICE_PROMPT_ADDED)";

    /** HTTP 401 through the workshop proxy: the proxy is open, but this token isn't valid. */
    public static String tokenRefusedHint() {
        return "Check WORKSHOP_TOKEN: it expired, was replaced, or was turned off by workshop staff. "
                + "Get a new one on " + Credentials.codePage() + ".";
    }

    /**
     * HTTP 404 through the workshop proxy: the token route is gone (the proxy runs on event
     * day only).
     */
    public static final String PROXY_CLOSED_HINT =
            "The workshop proxy is closed: it runs on event day only. Put your own DEEPGRAM_API_KEY "
                    + "in .env (free key: https://console.deepgram.com/signup) and leave WORKSHOP_TOKEN empty. "
                    + "Missions 01 and 02 use the `timing` feature: finish them with the offline check "
                    + "(make check 01), or on a Deepgram project that has the `timing` feature.";

    // The workshop proxy refuses a session it can't run with one Error before Welcome, then
    // closes 1013. The description says what to do; these are the same words, for a frame
    // that comes without one. A staff pause mid-run is a TALK_PAUSED Warning, then close 1000.
    public static final String TALK_UNCONFIGURED = "TALK_UNCONFIGURED";
    public static final String TALK_PAUSED = "TALK_PAUSED";
    public static final String ONLINE_FULL = "ONLINE_FULL";
    public static final String LIVE_CLOSED = "LIVE_CLOSED";

    public static final Map<String, String> TALK_MESSAGES = Map.of(
            TALK_UNCONFIGURED,
            "The workshop's live agent opens soon. Run your program again once it does, or set "
                    + "DEEPGRAM_API_KEY in .env and leave WORKSHOP_TOKEN empty to run on your own key now.",
            TALK_PAUSED, "Workshop staff paused the live agent for a minute. Run your program again shortly.",
            ONLINE_FULL, "The live agent's online seats are all taken right now. Wait a few minutes, then run your program again.",
            LIVE_CLOSED,
            "The workshop's live agent has closed. Your program runs on your own key now: set "
                    + "DEEPGRAM_API_KEY and leave WORKSHOP_TOKEN empty.");

    public static final Set<String> REFUSAL_CODES = TALK_MESSAGES.keySet();

    /**
     * Codes the workshop sends when it stops this token or session on purpose. Each prints a
     * [workshop] line, and the [closed] line after it is left out.
     */
    public static final Set<String> STOP_CODES = Set.of(
            TALK_UNCONFIGURED, TALK_PAUSED, ONLINE_FULL, LIVE_CLOSED,
            "TOKEN_REPLACED", "TOKEN_EXPIRED", "TOKEN_REVOKED", "SESSION_REPLACED",
            "SESSION_RESUMED", "SESSION_CLOSED_BY_STAFF", "SESSION_LIFETIME");

    /** In an offline check every agent frame is a recording: an Error there is sent on purpose. */
    public static final String REPLAY_ERROR_NOTE =
            "  [replay] The check sends this error on purpose, to see how your program handles it.";

    /**
     * What the ready line says about typed turns, by where they come from ("tty", "piped"
     * or null).
     */
    public static String readyHint(String typing) {
        if ("tty".equals(typing)) return " Type a line and press Enter to talk. Ctrl-D or Ctrl-C hangs up.";
        if ("piped".equals(typing)) return " Reading your lines from the input; it hangs up after the reply to the last one.";
        return "";
    }

    private static String text(Event event) {
        String description = event.str("description");
        if (description != null && !description.isEmpty()) return description;
        String message = event.str("message");
        return message != null && !message.isEmpty() ? message : null;
    }

    /** The one line for a refusal or a pause: the proxy's own words and the code. */
    public static String workshopLine(Event event) {
        String code = String.valueOf(event.str("code"));
        String text = text(event);
        if (text == null) text = TALK_MESSAGES.getOrDefault(code, "");
        return "[workshop] " + text + " (" + code + ")";
    }

    /** One line for an HTTP refusal of the connection, with its fix. */
    public static String refusedLine(Integer status, boolean workshop) {
        String hint = "";
        if (status != null && status == 401) {
            hint = workshop ? " " + tokenRefusedHint() : " Check DEEPGRAM_API_KEY.";
        } else if (status != null && status == 404 && workshop) {
            hint = " " + PROXY_CLOSED_HINT;
        }
        String who = workshop ? "The workshop proxy" : "Deepgram";
        return who + " refused the connection (HTTP " + status + ")." + hint;
    }

    /**
     * One line for a connection that never opened (nothing listening, a bad host). The
     * exception's own text can carry the endpoint, so it's never printed raw.
     */
    public static String unreachableLine(Throwable err, boolean workshop) {
        String var = workshop ? "WORKSHOP_URL" : "DEEPGRAM_AGENT_URL";
        for (Throwable t = err; t != null; t = t.getCause()) {
            String text = String.valueOf(t.getMessage());
            if (t instanceof ConnectException || text.contains("Connection refused") || text.contains("ConnectException")) {
                return "Could not reach the agent: connection refused. Check " + var + "."
                        + (workshop ? " Is the workshop site up?" : "");
            }
            if (t instanceof UnknownHostException || text.contains("UnknownHostException")) {
                return "Could not reach the agent: no such host. Check " + var + ".";
            }
            if (t instanceof SocketTimeoutException || t instanceof java.util.concurrent.TimeoutException
                    || text.contains("SocketTimeoutException")) {
                return "Could not reach the agent: it timed out. Check " + var + ".";
            }
            if (t.getCause() == null) {
                return "Could not reach the agent: " + t.getClass().getSimpleName() + ". Check " + var + ".";
            }
        }
        return "Could not reach the agent. Check " + var + ".";
    }

    /** 429 (busy) and 5xx (a server problem) can pass on a later try; other refusals can't. */
    public static boolean retryableStatus(Integer status) {
        return status != null && (status == 429 || status >= 500);
    }

    /** One readable line for an Error event, with a fix where we know one. */
    public static String explainError(Event event) {
        String code = event.str("code");
        if (code == null || code.isEmpty()) code = "no code";
        if (STOP_CODES.contains(code)) return workshopLine(event);
        String text = text(event);
        String line = "Agent error: " + (text == null ? "" : text) + " (" + code + ")";
        if (code.equals("UNPARSABLE_CLIENT_MESSAGE")) line += "\n  " + SETTINGS_REFUSED_HINT;
        else if (code.equals(CONCURRENCY_LIMIT_REACHED)) line += "\n  " + THINKING_BUSY_HINT;
        return line;
    }

    /**
     * One readable line for a Warning event, with its code when it has one. VOICE_PROMPT_ADDED
     * is a note.
     */
    public static String explainWarning(Event event) {
        String code = event.str("code");
        if (VOICE_PROMPT_ADDED.equals(code)) return VOICE_PROMPT_NOTE;
        if (code != null && STOP_CODES.contains(code)) return workshopLine(event);
        String text = text(event);
        text = text == null ? "" : text;
        return code != null && !code.isEmpty() ? "Agent warning: " + text + " (" + code + ")" : "Agent warning: " + text;
    }

    /**
     * What a run prints for an event, or null. {@code replay} marks lines from an offline
     * check; {@code typing} is the input mode the ready line describes (null: no typed turns).
     */
    public static String eventLine(Event event, boolean replay, String typing) {
        String kind = event.type();
        String line = null;
        if ("ConversationText".equals(kind)) {
            String content = event.str("content");
            if (content != null && !content.isBlank()) {
                String role = event.str("role");
                line = (role != null ? role : "None") + ": " + content; // "None", as common.py prints a missing role
            }
        } else if ("Error".equals(kind)) {
            line = explainError(event) + (replay ? "\n" + REPLAY_ERROR_NOTE : "");
        } else if ("Warning".equals(kind)) {
            line = explainWarning(event);
        } else if ("SettingsApplied".equals(kind)) {
            line = "[ready] the agent has your settings." + (replay ? "" : readyHint(typing));
        }
        if (line != null && replay) line = "[replay] " + line;
        return line;
    }
}
