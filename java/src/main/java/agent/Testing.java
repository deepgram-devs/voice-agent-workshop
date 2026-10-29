package agent;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Runs a mission against the check harness (tools/replay-server):
 *
 * <pre>
 *   replay: the harness plays a recorded conversation; no key, no network.
 *   live:   the harness relays to the real API and checks what really happened.
 * </pre>
 *
 * {@link Check} is the command line `make check` and `make live` use.
 */
public final class Testing {
    private Testing() {}

    public static final Path HARNESS = Common.PROJECT_ROOT.resolve("tools").resolve("replay-server").resolve("harness.mjs");
    public static final String REPLAY_KEY = "replay-check-no-real-key";
    static final long RUN_TIMEOUT_MS = 120_000;

    private static final Pattern FAILED_TODO = Pattern.compile("FAIL\\s+TODO (\\d+)");
    private static final Pattern MISSION_PACKAGE = Pattern.compile("^m(\\d{2})_([a-z0-9_]+)$");

    public record Verdict(boolean passed, String report) {}

    /** "m00_first_words" -> "00-first-words", the mission folder. */
    public static String missionName(String pkg) {
        Matcher m = MISSION_PACKAGE.matcher(pkg);
        if (!m.matches()) throw new IllegalArgumentException("not a mission package: " + pkg);
        return m.group(1) + "-" + m.group(2).replace('_', '-');
    }

    /**
     * Which file a check runs: Start (yours, the default) or Solution. mission.sh says which
     * class it compiled (-Dworkshop.target); else MISSION_TARGET from the shell, as make and
     * mission.sh read it (never from .env, which would check a class that wasn't compiled).
     */
    public static String target() {
        String compiled = System.getProperty("workshop.target", "");
        if (compiled.equals("Start") || compiled.equals("Solution")) return compiled;
        String value = Env.shell("MISSION_TARGET").trim();
        if (value.isEmpty() || value.equals("start")) return "Start";
        if (value.equals("solution")) return "Solution";
        throw new IllegalArgumentException("MISSION_TARGET must be start or solution");
    }

    /** The file a check runs: java/missions/m00_first_words/Start.java (or Solution.java). */
    public static Path targetPath(String pkg) {
        return Common.PROJECT_ROOT.resolve("java").resolve("missions").resolve(pkg).resolve(target() + ".java");
    }

    /** A new instance of the mission class a check runs. */
    public static Mission loadTarget(String pkg) throws ReflectiveOperationException {
        Class<?> type = Class.forName(pkg + "." + target());
        return (Mission) type.getDeclaredConstructor().newInstance();
    }

    /** The words for no Node.js at all: the Makefile's MSG_NODE_OLD, with "you have none". */
    static final String NO_NODE = "The checks need Node.js 20.19+ or 22.12+ (you have none). "
            + "Install Node.js 22 from https://nodejs.org, then run make setup again.";

    static String node() {
        return node(HARNESS, System.getenv("PATH"));
    }

    /**
     * The node to run the harness with (looked up on {@code path}), or one line saying
     * what's missing.
     */
    static String node(Path harness, String path) {
        String found = null;
        if (path != null) {
            for (String dir : path.split(java.io.File.pathSeparator)) {
                Path candidate = Paths.get(dir.isEmpty() ? "." : dir, "node");
                if (Files.isExecutable(candidate)) {
                    found = candidate.toString();
                    break;
                }
            }
        }
        if (found == null) {
            throw new IllegalStateException(NO_NODE);
        }
        if (!Files.isDirectory(harness.getParent().resolve("node_modules"))) {
            throw new IllegalStateException("The check harness isn't installed. Run make setup in the voice-agent-workshop folder.");
        }
        return found;
    }

    /** The replay scenarios of a mission, from the harness. */
    public static List<String> replayScenarios(String mission) throws IOException, InterruptedException {
        return replayScenarios(HARNESS, mission);
    }

    static List<String> replayScenarios(Path harness, String mission) throws IOException, InterruptedException {
        Process p = new ProcessBuilder(node(harness, System.getenv("PATH")), harness.toString(), "list", mission).start();
        // stderr on its own thread, so a long one can't stall the harness while stdout is read.
        CompletableFuture<String> errText = CompletableFuture.supplyAsync(() -> {
            try {
                return new String(p.getErrorStream().readAllBytes(), StandardCharsets.UTF_8);
            } catch (IOException e) {
                return "";
            }
        });
        String out = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        String err = errText.join();
        int code = p.waitFor();
        if (code != 0) {
            // The harness's own line says why (a Node.js outside its range, say): pass it on.
            String said = (err.isEmpty() ? out : err).strip();
            // Java reports a process a signal stopped as 128 + the signal's number; a real exit
            // can be 128 or more too, so both are said.
            String how = code >= 128 ? "exit " + code + ", or signal " + (code - 128) : "exit " + code;
            throw new IllegalStateException(!said.isEmpty() ? said
                    : "The check harness stopped (" + how + ") without a message. Run make setup, then try again.");
        }
        List<String> names = new ArrayList<>();
        for (JsonNode item : Json.parse(out).path("replay")) names.add(item.asText());
        return names;
    }

    /**
     * The second line when `make live` has no credentials: what it needs, and the offline
     * check.
     */
    public static String liveHint(String mission) {
        String nn = mission.substring(0, 2);
        return "make live talks to the real agent, so it needs DEEPGRAM_API_KEY in .env (or WORKSHOP_URL and "
                + "WORKSHOP_TOKEN from the workshop's /code page). make check " + nn + " runs offline with no key.";
    }

    private static final Pattern FAIL_LINE = Pattern.compile("(?m)^\\s*FAIL\\s");
    private static final Pattern BUILD_SETTINGS = Pattern.compile("^\\s*(public\\s+)?\\S+\\s+buildSettings\\s*\\(");

    /**
     * One line naming your file, at the first TODO the report says failed: the place to work.
     * With that TODO's comment gone (or no TODO in the report, as for a wrong {@code version}),
     * the line is buildSettings(), where every mission's Settings are built.
     */
    public static String whereToEdit(Path path, String report) {
        Path abs = path.toAbsolutePath();
        Path shown = abs.startsWith(Common.PROJECT_ROOT) ? Common.PROJECT_ROOT.relativize(abs) : path;
        Matcher failed = FAILED_TODO.matcher(report);
        String todoNumber = failed.find() ? failed.group(1) : null;
        if (!Files.exists(path)) return "Your file: " + shown;
        List<String> lines;
        try {
            lines = Files.readAllLines(path, StandardCharsets.UTF_8);
        } catch (IOException e) {
            return "Your file: " + shown;
        }
        if (todoNumber != null) {
            Pattern todo = Pattern.compile("(#|//)\\s*TODO " + todoNumber + "\\b");
            for (int i = 0; i < lines.size(); i++) {
                if (todo.matcher(lines.get(i)).find()) {
                    return "Your file: " + shown + ":" + (i + 1) + " (TODO " + todoNumber + ")";
                }
            }
        }
        if (!FAIL_LINE.matcher(report).find()) return "Your file: " + shown; // a setup stop: nothing in your file to point at
        for (int i = 0; i < lines.size(); i++) {
            if (BUILD_SETTINGS.matcher(lines.get(i)).find()) {
                return todoNumber != null
                        ? "Your file: " + shown + ":" + (i + 1) + " (TODO " + todoNumber + "; its // TODO comment is gone, so start at buildSettings())"
                        : "Your file: " + shown + ":" + (i + 1) + " (buildSettings())";
            }
        }
        return "Your file: " + shown;
    }

    /** The harness output a person reads: its READY and VERDICT lines are for this code only. */
    static String report(List<String> lines) {
        String text = lines.stream()
                .filter(l -> !l.startsWith("READY ") && !l.startsWith("VERDICT "))
                .collect(Collectors.joining("\n"));
        return text.replaceAll("^\\n+", "").replaceAll("\\n+$", "");
    }

    public static Verdict checkReplay(String pkg, Mission mission, String scenario) throws IOException, InterruptedException {
        return run("replay", pkg, mission, scenario);
    }

    public static Verdict checkLive(String pkg, Mission mission) throws IOException, InterruptedException {
        return run("live", pkg, mission, null);
    }

    static Verdict run(String mode, String pkg, Mission mission, String scenario) throws IOException, InterruptedException {
        Env.load();
        String name = missionName(pkg);
        if (mode.equals("live")) {
            // Fail at once, before the harness waits for a program that can't connect.
            String problem = Credentials.credentialsProblem(null, name);
            if (problem != null) return new Verdict(false, problem + "\n" + liveHint(name));
        }
        List<String> args = new ArrayList<>(List.of(node(), HARNESS.toString(), mode, name));
        if (scenario != null) args.add(scenario);
        args.add("--source");
        args.add(targetPath(pkg).toString()); // read for old API field names
        String record = Env.get("RECORD_FIXTURE").trim();
        if (mode.equals("live") && !record.isEmpty()) {
            // Mission authors: save this live run as a fixture (see CONTRIBUTING.md).
            args.add("--record");
            args.add(Paths.get(record).toAbsolutePath().toString());
        }
        ProcessBuilder builder = new ProcessBuilder(args).redirectErrorStream(true);
        builder.environment().clear();
        builder.environment().putAll(Env.childEnvironment());
        Process proc = builder.start();
        try {
            return drive(mode, pkg, mission, name, proc);
        } finally {
            if (proc.isAlive()) proc.destroyForcibly();
        }
    }

    private static Verdict drive(String mode, String pkg, Mission mission, String name, Process proc)
            throws IOException, InterruptedException {
        List<String> lines = Collections.synchronizedList(new ArrayList<>());
        CompletableFuture<String> ready = new CompletableFuture<>();
        Thread reader = new Thread(() -> {
            try (BufferedReader in = new BufferedReader(new InputStreamReader(proc.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = in.readLine()) != null) {
                    String l = line.stripTrailing();
                    lines.add(l);
                    if (l.startsWith("READY ")) ready.complete(l.substring("READY ".length()));
                }
            } catch (IOException e) {
                // The harness ended.
            }
            ready.complete(null);
        }, "harness-output");
        reader.setDaemon(true);
        reader.start();

        String url;
        try {
            url = ready.get();
        } catch (ExecutionException e) {
            url = null;
        }
        if (url == null) {
            proc.waitFor();
            reader.join();
            return new Verdict(false, report(lines));
        }

        Common.RunOptions options = new Common.RunOptions();
        options.url = url;
        options.apiKey = mode.equals("replay") ? REPLAY_KEY : null; // live: your key, forwarded by the harness
        options.interactive = false;
        options.replay = mode.equals("replay");
        String clientError = null;
        String setupError = null;
        CompletableFuture<Agent> runs = CompletableFuture.supplyAsync(() -> {
            try {
                return Common.runAsync(mission, options);
            } catch (SetupError | InterruptedException e) {
                throw new java.util.concurrent.CompletionException(e);
            }
        }, runner());
        try {
            runs.get(RUN_TIMEOUT_MS, TimeUnit.MILLISECONDS);
        } catch (ExecutionException e) {
            Throwable cause = e.getCause();
            if (cause instanceof SetupError s) {
                // Your program couldn't start (no credentials, a bad URL): say so first, and
                // stop the harness now, not let it wait for a connection that won't come.
                setupError = s.getMessage();
                proc.destroy();
            } else {
                Throwable shown = cause instanceof MissionError && cause.getCause() != null ? cause.getCause() : cause;
                clientError = "your program stopped with " + Redact.describeError(shown) + where(shown);
            }
        } catch (TimeoutException e) {
            clientError = "your program stopped with TimeoutException: no result after " + RUN_TIMEOUT_MS / 1000 + " s";
            proc.destroy();
        }
        proc.waitFor();
        reader.join();
        if (setupError != null) {
            // A setup line ends on its own fix; the hint is for missing credentials only.
            return new Verdict(false, setupError);
        }
        JsonNode verdict = null;
        synchronized (lines) {
            for (int i = lines.size() - 1; i >= 0 && verdict == null; i--) {
                if (lines.get(i).startsWith("VERDICT ")) {
                    try {
                        verdict = Json.parse(lines.get(i).substring("VERDICT ".length()));
                    } catch (IllegalArgumentException e) {
                        verdict = null;
                    }
                }
            }
        }
        String text = report(lines);
        if (clientError != null) text += "\n" + clientError;
        boolean passed = verdict != null && verdict.path("pass").asBoolean(false) && clientError == null;
        boolean stopped = verdict != null && verdict.path("stopped").asBoolean(false);
        if (!passed && !stopped) { // a refused session: nothing in your file to change
            text += "\n" + whereToEdit(targetPath(pkg), text);
        }
        return new Verdict(passed, text);
    }

    /**
     * One line for a mission class that couldn't be made: its static initializer, a field
     * initializer or its constructor threw. Names what it threw, not Java's wrapper, and where.
     */
    static String cantLoad(String className, Throwable e) {
        Throwable shown = (e instanceof java.lang.reflect.InvocationTargetException || e instanceof ExceptionInInitializerError)
                && e.getCause() != null ? e.getCause() : e;
        return "Can't load " + className + ": " + Redact.describeError(shown) + where(shown);
    }

    /** " (Start.java:42)": the line in your mission file the error came from, when it did. */
    static String where(Throwable err) {
        for (StackTraceElement frame : err.getStackTrace()) {
            String cls = frame.getClassName();
            if (cls.matches("^m\\d{2}_[a-z0-9_]+\\..*") && frame.getFileName() != null && frame.getLineNumber() > 0) {
                return " (" + frame.getFileName() + ":" + frame.getLineNumber() + ")";
            }
        }
        return "";
    }

    private static java.util.concurrent.Executor runner() {
        return r -> {
            Thread t = new Thread(r, "mission-run");
            t.setDaemon(true);
            t.start();
        };
    }
}
