package agent;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Keys and URLs: which endpoint a run connects to, and with which credential. They come
 * from the shell or .env (see {@link Env}); nothing here ever prints a key or a token.
 */
public final class Credentials {
    public static final String PROD_AGENT_URL = "wss://agent.deepgram.com";
    public static final String AGENT_PATH = "/v1/agent/converse";

    /**
     * With no .env at all (make setup creates one): the same line as common.py and common.ts.
     * README "Troubleshooting" keys on the first words of both lines.
     */
    public static final String NO_CREDENTIALS =
            "No Deepgram credentials. Copy .env.example to .env and set DEEPGRAM_API_KEY "
                    + "(free key: https://console.deepgram.com/signup), or paste WORKSHOP_URL and WORKSHOP_TOKEN from the workshop's /code page.";

    public static final String BAD_AGENT_URL =
            "DEEPGRAM_AGENT_URL isn't a valid address. Copy it again, or leave it empty for Deepgram production.";
    public static final String BAD_WORKSHOP_URL =
            "WORKSHOP_URL isn't a valid address. Copy it again from the workshop's /code page.";

    // What DEEPGRAM_AGENT_URL or WORKSHOP_URL must look like, the same pattern body in common.py,
    // common.ts and the harness (tools/parity/addresses.json): ws:// or wss://, a host, an
    // optional port from 1 to 65535, then printable ASCII only. Checked in plan(), before any
    // client exists; Common's catch at connect stays as the backstop.
    private static final Pattern ADDRESS =
            Pattern.compile("wss?://(\\[[0-9A-Fa-f:.]+\\]|[A-Za-z0-9._-]+)(?::([0-9]{1,5}))?(?:[/?#][\\x21-\\x7E]*)?");
    private static final Pattern MISSION_PACKAGE = Pattern.compile("^m(\\d{2})_([a-z0-9_]+)$");
    private static final Pattern SITE = Pattern.compile("^(wss|ws|https|http)://([^/?#" + Env.WS_CHARS + "]+(?:/[^?#" + Env.WS_CHARS + "]*)?)");

    private Credentials() {}

    /** Where a run connects, and how: a key ("Token") or the workshop token ("Bearer"). */
    public record Target(String base, String apiKey, String token, boolean workshop) {}

    static String env(String name) {
        return Env.pyStrip(Env.get(name));
    }

    /**
     * DEEPGRAM_AGENT_URL may be a host (wss://agent.deepgram.com) or the full converse URL.
     * The SDK adds /v1/agent/converse itself, so it's stripped.
     */
    public static String agentBaseUrl(String raw) throws SetupError {
        String url = stripSlashes(raw == null || raw.isEmpty() ? PROD_AGENT_URL : Env.pyStrip(raw));
        if (url.endsWith(AGENT_PATH)) url = url.substring(0, url.length() - AGENT_PATH.length());
        if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
            // The value stays out of the message: it can name an endpoint that belongs out
            // of logs.
            throw new SetupError("DEEPGRAM_AGENT_URL must start with wss:// (or ws:// for the local check harness). "
                    + "Leave it empty for Deepgram production.");
        }
        if (!validAddress(url)) throw new SetupError(BAD_AGENT_URL); // the value stays out of this one too
        return url;
    }

    /** True when {@code url} is an address the SDK can open: the pattern and the port range. */
    static boolean validAddress(String url) {
        Matcher m = ADDRESS.matcher(url);
        if (!m.matches()) return false;
        if (m.group(2) == null) return true;
        int port = Integer.parseInt(m.group(2));
        return port >= 1 && port <= 65535;
    }

    /**
     * The mission folder a mission class belongs to: package m00_first_words is
     * "00-first-words"; else null.
     */
    public static String missionOf(Class<?> missionClass) {
        Matcher m = MISSION_PACKAGE.matcher(missionClass.getPackageName());
        return m.matches() ? m.group(1) + "-" + m.group(2).replace('_', '-') : null;
    }

    /**
     * WORKSHOP_URL (the {@code wss://<host>/sdk} the /code page shows) plus the mission
     * folder. The SDK adds /v1/agent/converse, and the proxy logs the conversation under
     * that mission on your map.
     */
    public static String workshopBaseUrl(String raw, String mission) throws SetupError {
        String url = stripSlashes(raw == null ? "" : Env.pyStrip(raw));
        if (url.isEmpty()) {
            throw new SetupError("WORKSHOP_TOKEN is set but WORKSHOP_URL is empty. "
                    + "Copy both lines from the workshop's /code page into .env.");
        }
        if (url.startsWith("https://")) url = "wss://" + url.substring("https://".length());
        else if (url.startsWith("http://")) url = "ws://" + url.substring("http://".length());
        if (url.endsWith(AGENT_PATH)) url = url.substring(0, url.length() - AGENT_PATH.length());
        if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
            throw new SetupError("WORKSHOP_URL must start with wss://. Copy it again from the workshop's /code page.");
        }
        if (!validAddress(url)) throw new SetupError(BAD_WORKSHOP_URL);
        if (!url.endsWith("/sdk")) {
            // The site's own address (no /sdk) reaches no proxy, which reads like a closed one.
            throw new SetupError("WORKSHOP_URL should end in /sdk. Copy both lines from " + codePage() + " into .env.");
        }
        return mission != null ? url + "/" + mission : url;
    }

    /**
     * True when WORKSHOP_TOKEN and WORKSHOP_URL are both set and DEEPGRAM_AGENT_URL is not:
     * the run uses the workshop token, even with a DEEPGRAM_API_KEY in the shell. Leave
     * WORKSHOP_TOKEN empty to use your key.
     */
    public static boolean tokenWins() {
        return !env("WORKSHOP_TOKEN").isEmpty() && !env("WORKSHOP_URL").isEmpty() && env("DEEPGRAM_AGENT_URL").isEmpty();
    }

    /**
     * True when this run goes through the workshop proxy: WORKSHOP_TOKEN set, no explicit
     * {@code apiKey} or {@code url}, no DEEPGRAM_AGENT_URL, and either WORKSHOP_URL set (the
     * token wins) or no DEEPGRAM_API_KEY.
     */
    public static boolean usesWorkshop(String url, String apiKey) {
        if (notBlank(apiKey) || notBlank(url) || !env("DEEPGRAM_AGENT_URL").isEmpty() || env("WORKSHOP_TOKEN").isEmpty()) {
            return false;
        }
        return tokenWins() || env("DEEPGRAM_API_KEY").isEmpty();
    }

    /**
     * The workshop site's address (https://host/path), read from WORKSHOP_URL without its /sdk
     * (and anything after it) or a pasted page's /code, /resume or {@code /m/<mission>}, or
     * null. ws:// and http:// keep http.
     */
    public static String workshopSite() {
        Matcher m = SITE.matcher(env("WORKSHOP_URL"));
        if (!m.find()) return null;
        String scheme = m.group(1).equals("ws") || m.group(1).equals("http") ? "http" : "https";
        return scheme + "://" + m.group(2).replaceAll("/+$", "").replaceAll("/sdk(?:/.*)?$", "").replaceAll("/(?:m/.*|code|resume)$", "");
    }

    /** Where to get a workshop token: the site's /code page, by address when we know it. */
    public static String codePage() {
        String site = workshopSite();
        return site != null ? site + "/code" : "the workshop site's /code page";
    }

    /**
     * The line for a run with neither a key nor a token, by whether .env exists: the file
     * {@code make setup} created with an empty key is the usual case, so that one says
     * "empty", never "copy". {@code mission} (the folder) fills in the mission number.
     */
    public static String noCredentialsLine(String mission) {
        return noCredentialsLine(mission, Env.dotenvExists());
    }

    /** {@link #noCredentialsLine(String)} with the .env check given (tests). */
    public static String noCredentialsLine(String mission, boolean hasEnv) {
        String nn = mission != null && mission.length() >= 2 ? mission.substring(0, 2) : "NN";
        if (hasEnv) {
            // "this folder": the project folder, where make runs (the README says so, next to this line).
            return "DEEPGRAM_API_KEY is empty in .env (this folder). Set it, or paste WORKSHOP_URL and WORKSHOP_TOKEN "
                    + "from the workshop's /code page. make check " + nn + " runs offline with no key.";
        }
        return NO_CREDENTIALS;
    }

    /**
     * The no-credentials line when there is neither a key ({@code apiKey} or DEEPGRAM_API_KEY)
     * nor a WORKSHOP_TOKEN, else null. Checks only whether they are set, never their values.
     */
    public static String credentialsProblem(String apiKey, String mission) {
        boolean key = notBlank(apiKey) || !env("DEEPGRAM_API_KEY").isEmpty();
        return key || !env("WORKSHOP_TOKEN").isEmpty() ? null : noCredentialsLine(mission);
    }

    /** {@link #credentialsProblem(String, String)} with no mission number to fill in. */
    public static String credentialsProblem(String apiKey) {
        return credentialsProblem(apiKey, null);
    }

    /**
     * One line saying which credential this run uses, when DEEPGRAM_API_KEY and WORKSHOP_TOKEN
     * are both set, else null. Never prints either value.
     */
    public static String credentialsNote() {
        if (env("DEEPGRAM_API_KEY").isEmpty() || env("WORKSHOP_TOKEN").isEmpty()) return null;
        if (tokenWins()) {
            return "[credentials] Using your workshop token (the proxy); your DEEPGRAM_API_KEY is set too "
                    + "and waits for after the event. To run on it now, leave WORKSHOP_TOKEN empty.";
        }
        String why = env("DEEPGRAM_AGENT_URL").isEmpty() ? "WORKSHOP_URL is empty" : "DEEPGRAM_AGENT_URL is set";
        return "[credentials] Using your DEEPGRAM_API_KEY; your workshop token is not used because " + why + ".";
    }

    /**
     * Where and how a run connects. Order: an explicit apiKey; then the workshop token when
     * WORKSHOP_TOKEN and WORKSHOP_URL are both set (sent as a bearer token, see tokenWins);
     * then DEEPGRAM_API_KEY; then WORKSHOP_TOKEN. Through the proxy, {@code mission} picks
     * where your conversation counts. An explicit {@code url} (the local check harness) gets
     * the same credential; the harness relays it on.
     */
    public static Target plan(String url, String apiKey, String mission) throws SetupError {
        String token = env("WORKSHOP_TOKEN");
        String key = notBlank(apiKey) ? apiKey : (tokenWins() ? "" : env("DEEPGRAM_API_KEY"));
        if (key.isEmpty() && !token.isEmpty() && !notBlank(url) && !env("DEEPGRAM_AGENT_URL").isEmpty()) {
            // The workshop token belongs to the workshop proxy only.
            throw new SetupError("DEEPGRAM_AGENT_URL needs your own DEEPGRAM_API_KEY. With a workshop token, "
                    + "leave DEEPGRAM_AGENT_URL empty: the workshop proxy picks the endpoint.");
        }
        boolean workshop = usesWorkshop(url, apiKey);
        String base = workshop
                ? workshopBaseUrl(Env.get("WORKSHOP_URL"), mission)
                : agentBaseUrl(notBlank(url) ? url : Env.get("DEEPGRAM_AGENT_URL"));
        String problem = credentialsProblem(apiKey, mission);
        if (problem != null) throw new SetupError(problem);
        // OkHttp refuses most such characters (the SDK then reports a bad address), and a space
        // or tab in a key or token is a paste error too.
        if (!key.isEmpty() && !printable(key)) throw new SetupError(badCharacter("DEEPGRAM_API_KEY", "a key"));
        if (key.isEmpty() && !printable(token)) throw new SetupError(badCharacter("WORKSHOP_TOKEN", "a token"));
        return key.isEmpty() ? new Target(base, null, token, workshop) : new Target(base, key, null, workshop);
    }

    /** True when every character is printable ASCII (0x21 to 0x7E): no spaces, no curly quotes. */
    static boolean printable(String s) {
        return s.chars().allMatch(c -> c >= 0x21 && c <= 0x7E);
    }

    /** The line for a key or token with a character it can't have. Never prints the value. */
    static String badCharacter(String name, String what) {
        return name + " has a character " + what + " can't have (a curly quote or a hidden space, often from copy "
                + "and paste). Copy it again as plain text.";
    }

    private static String stripSlashes(String url) {
        while (url.endsWith("/")) url = url.substring(0, url.length() - 1);
        return url;
    }

    private static boolean notBlank(String s) {
        return s != null && !s.isBlank();
    }
}
