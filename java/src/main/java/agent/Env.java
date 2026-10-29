package agent;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Configuration: the shell's variables, then .env in the voice-agent-workshop folder.
 * A variable set in the shell wins, even when it's empty, as in Python's load_dotenv.
 * Java can't change its own environment, so {@link #childEnvironment()} hands the
 * merged values to the check harness.
 */
public final class Env {
    /** The characters Python's \s matches, which python-dotenv's rules are written in. */
    static final String WS_CHARS = "\\t\\n\\x0B\\f\\r\\x1C-\\x1F \\x85\\xA0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000";
    static final String WS = "[" + WS_CHARS + "]";
    private static final Pattern LINE = Pattern.compile(
            "^" + WS + "*(?>(?:export" + WS + "+)?)(?:'([^']+)'|([^'=#" + WS_CHARS + "][^=#" + WS_CHARS + "]*))" + WS + "*=(.*)$",
            Pattern.DOTALL);
    private static final Pattern BARE = Pattern.compile(
            "^" + WS + "*(?>(?:export" + WS + "+)?)(?:'([^']+)'|([^'=#" + WS_CHARS + "][^=#" + WS_CHARS + "]*))" + WS + "*(#.*)?$",
            Pattern.DOTALL);
    private static final Pattern BLANK_OR_COMMENT = Pattern.compile("^" + WS + "*(#.*)?$", Pattern.DOTALL);
    private static final Pattern UNQUOTED = Pattern.compile("^(.*?)(" + WS + "+#.*)?$", Pattern.DOTALL);
    private static final Pattern AFTER_QUOTE = Pattern.compile(WS + "*(#.*)?", Pattern.DOTALL);

    private static volatile Map<String, String> shell = System.getenv();
    private static volatile Map<String, String> file = Map.of();
    private static volatile Path dotenv = null;
    private static volatile boolean loaded;
    private static boolean warned;
    private static final java.util.Set<String> warnings = new java.util.HashSet<>();

    private static void warnOnce(String line) {
        if (warnings.add(line)) System.err.println(line);
    }

    private Env() {}

    /** Reads .env again (the project root's, or the one {@link #useForTests} named). */
    public static synchronized void load() {
        Path path = dotenv != null ? dotenv : Common.PROJECT_ROOT.resolve(".env");
        try {
            file = parse(Files.readString(path, StandardCharsets.UTF_8), Env::warnOnce);
        } catch (java.nio.charset.CharacterCodingException e) {
            file = Map.of();
            if (!warned) {
                warned = true;
                System.err.println(".env isn't UTF-8 text, so none of it was read. Save it as UTF-8 (plain text), then run this again.");
            }
        } catch (IOException e) {
            file = Map.of(); // no .env: the shell's variables only
        }
        loaded = true;
    }

    /** True when the project's .env (or the one {@link #useForTests} named) is there to edit. */
    public static boolean dotenvExists() {
        Path path = dotenv != null ? dotenv : Common.PROJECT_ROOT.resolve(".env");
        return Files.isRegularFile(path);
    }

    /** A variable's value: the shell's when set there, else .env's, else "". */
    public static String get(String name) {
        if (!loaded) load();
        String value = shell.get(name);
        if (value == null) value = file.get(name);
        return value == null ? "" : value;
    }

    /**
     * A variable's value as {@link #get} gives it, trimmed the way Python's str.strip()
     * trims (Unicode spaces too), so a mission reads it as the Python one does
     * ({@code os.environ.get(name, "").strip()}).
     */
    public static String stripped(String name) {
        return pyStrip(get(name));
    }

    /**
     * A variable from the shell only, or "" (for what make and mission.sh read from the
     * shell too).
     */
    public static String shell(String name) {
        String value = shell.get(name);
        return value == null ? "" : value;
    }

    /** The shell's environment plus every .env value the shell doesn't set: for child processes. */
    public static Map<String, String> childEnvironment() {
        if (!loaded) load();
        Map<String, String> env = new HashMap<>(file);
        env.putAll(shell);
        return env;
    }

    /**
     * KEY=VALUE lines, read as python-dotenv 1.2.4 reads them (the version python/uv.lock
     * pins), checked case by case against it:
     * <ul>
     *   <li>lines end at LF, CRLF or CR, and a byte order mark is skipped;
     *   <li>`export` before a key is allowed; a key is 'quoted', or doesn't start with a
     *       single quote and has no `=`, `#` or blanks;
     *   <li>a line with a key and no `=` unsets that key (python-dotenv reads it as no value);
     *   <li>any other line that isn't blank, a comment or KEY=value is dropped, with a line
     *       saying so;
     *   <li>an unquoted value ends at a `#` with a blank before it, and is trimmed;
     *   <li>a quoted value ends at its closing quote; only blanks or a `#` comment may follow,
     *       else the line is dropped, as an unclosed quote's is;
     *   <li>inside double quotes, the escapes \\ \" \' \a \b \f \n \r \t \v; inside single
     *       quotes, only \\ and \';
     *   <li>"blank" is what Python's \s matches (no-break and other Unicode spaces too).
     * </ul>
     * Two things python-dotenv does are not supported here: a quote, in a key or a value,
     * can't run over a line ending (that line is dropped, and the lines after it read as lines
     * of their own), and ${VAR} is never expanded (python-dotenv's load_dotenv expands it; here
     * it stays as written).
     */
    public static Map<String, String> parse(String text) {
        return parse(text, line -> {});
    }

    /**
     * As {@link #parse(String)}, handing {@code problem} one line for each line it drops for
     * a quote.
     */
    public static Map<String, String> parse(String text, java.util.function.Consumer<String> problem) {
        if (text.startsWith("\uFEFF")) text = text.substring(1);
        Map<String, String> out = new LinkedHashMap<>();
        String[] lines = text.split("\\r\\n|\\r|\\n");
        for (int n = 0; n < lines.length; n++) {
            Matcher m = LINE.matcher(lines[n]);
            if (!m.matches()) {
                Matcher bare = BARE.matcher(lines[n]);
                if (bare.matches()) {
                    out.remove(bare.group(1) != null ? bare.group(1) : bare.group(2));
                } else if (!BLANK_OR_COMMENT.matcher(lines[n]).matches()) {
                    problem.accept(badLine(n + 1)); // python-dotenv says so too ("could not parse")
                }
                continue;
            }
            String value = value(m.group(3));
            if (value == null) {
                problem.accept(unreadLine(n + 1));
            } else {
                out.put(m.group(1) != null ? m.group(1) : m.group(2), value);
            }
        }
        return out;
    }

    /** The line for a .env line that isn't KEY=value (the no-helpers example prints the same). */
    static String badLine(int n) {
        return ".env line " + n + " couldn't be read: it isn't KEY=value. Fix that line, then run this again.";
    }

    /** The line for a .env line dropped for its quotes (the no-helpers example prints the same). */
    static String unreadLine(int n) {
        return ".env line " + n + " couldn't be read: its quote never closes, or text follows the closing quote. "
                + "Fix that line, then run this again.";
    }

    /** Python's str.strip(): trims the blanks Python's \s matches, Unicode spaces too. */
    static String pyStrip(String s) {
        return s.replaceAll("^" + WS + "+|" + WS + "+$", "");
    }

    /** A line's value, or null when python-dotenv would drop the line. */
    private static String value(String rest) {
        String v = rest.replaceAll("^" + WS + "+", "");
        if (v.isEmpty() || (v.charAt(0) != '"' && v.charAt(0) != '\'')) {
            Matcher m = UNQUOTED.matcher(rest);
            m.matches();
            return pyStrip(m.group(1));
        }
        char q = v.charAt(0);
        StringBuilder inside = new StringBuilder();
        for (int i = 1; i < v.length(); i++) {
            char c = v.charAt(i);
            if (c == '\\' && i + 1 < v.length()) {
                char next = v.charAt(i + 1);
                String decoded = q == '"' ? DOUBLE_ESCAPES.get(next) : (next == '\\' || next == '\'' ? String.valueOf(next) : null);
                if (decoded != null) {
                    inside.append(decoded);
                    i++;
                    continue;
                }
                inside.append(c);
            } else if (c == q) {
                return AFTER_QUOTE.matcher(v.substring(i + 1)).matches() ? inside.toString() : null;
            } else {
                inside.append(c);
            }
        }
        return null; // no closing quote
    }

    private static final Map<Character, String> DOUBLE_ESCAPES = Map.ofEntries(
            Map.entry('\\', "\\"), Map.entry('"', "\""), Map.entry('\'', "'"), Map.entry('a', "\u0007"),
            Map.entry('b', "\b"), Map.entry('f', "\f"), Map.entry('n', "\n"), Map.entry('r', "\r"),
            Map.entry('t', "\t"), Map.entry('v', "\u000B"));

    /** Tests only: a made-up shell and .env file (null: none). {@link #resetForTests} undoes it. */
    static synchronized void useForTests(Map<String, String> shellVars, Path dotenvFile) {
        shell = Map.copyOf(shellVars);
        warnings.clear();
        dotenv = dotenvFile != null ? dotenvFile : Path.of(System.getProperty("java.io.tmpdir"), "no-such-folder", ".env");
        load();
    }

    static synchronized void resetForTests() {
        shell = System.getenv();
        dotenv = null;
        load();
    }
}
