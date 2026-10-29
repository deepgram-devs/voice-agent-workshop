package agent;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Printing errors safely: nothing printed may carry a key, a request header or an endpoint. */
public final class Redact {
    // "invalid Authorization header: Token <the value>" (a library's message): the rest of that
    // line, never the next one. Python's and TypeScript's redact have the same pattern.
    private static final Pattern AUTH_HEADER_LINE = Pattern.compile("(?i)(\\bauthorization header:[ \\t]*)[^\\n]*");
    private static final Pattern AUTH_HEADER =
            Pattern.compile("(?i)(['\"]?authorization['\"]?\\s*[:=]\\s*['\"]?)[^'\",}\\n]*");
    private static final Pattern AUTH_VALUE = Pattern.compile("(?i)\\b(token|bearer)(\\s+)[A-Za-z0-9._~+/=-]{12,}");
    private static final Pattern URL = Pattern.compile("(?i)\\b(wss?|https?)://[^\\s'\",)]+");

    private Redact() {}

    /**
     * Masks anything that looks like a credential: the configured key and token, an
     * Authorization header in any form (an {@code invalid Authorization header:} line to its
     * end), and {@code Token ...} / {@code Bearer ...} values.
     */
    public static String redact(String text) {
        if (text == null) return "";
        for (String name : new String[] {"DEEPGRAM_API_KEY", "WORKSHOP_TOKEN"}) {
            String secret = Env.pyStrip(Env.get(name));
            if (secret.length() >= 8) text = text.replace(secret, "[redacted]");
        }
        text = AUTH_HEADER_LINE.matcher(text).replaceAll(m -> Matcher.quoteReplacement(m.group(1) + "[redacted]"));
        text = AUTH_HEADER.matcher(text).replaceAll(m -> Matcher.quoteReplacement(m.group(1) + "[redacted]"));
        return AUTH_VALUE.matcher(text).replaceAll(m -> Matcher.quoteReplacement(m.group(1) + m.group(2) + "[redacted]"));
    }

    /**
     * One printable line for an exception: its type and message, credentials masked and
     * any URL left out (an endpoint can belong out of logs).
     */
    public static String describeError(Throwable err) {
        String message = err.getMessage();
        String text = err.getClass().getSimpleName() + (message == null || message.isBlank() ? "" : ": " + message);
        text = URL.matcher(redact(text)).replaceAll("[url]");
        int newline = text.indexOf('\n');
        return newline >= 0 ? text.substring(0, newline) : text;
    }
}
