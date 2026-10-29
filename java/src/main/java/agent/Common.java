package agent;

import com.deepgram.DeepgramClient;
import com.deepgram.DeepgramClientBuilder;
import com.deepgram.core.Environment;
import com.deepgram.resources.agent.v1.websocket.V1WebSocketClient;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Every place this project touches the Deepgram Java SDK lives in this package (here,
 * {@link Agent} and {@link RawTransport}). Missions use these and never import
 * com.deepgram, so an SDK upgrade is a change to one place. What it gives a mission:
 *
 * <pre>
 *   Common.run(new Start(), args)   connect, send your Settings, print the transcript,
 *                                   let you type turns, save the agent's voice to a WAV
 *   Common.listenProvider()         the listen model every mission uses (LISTEN_MODEL in .env)
 *   Agent                           the senders a mission needs: updatePrompt,
 *                                   injectAgentMessage, functionCallResponse, ...
 *   agent.sendRaw(json)             the escape hatch for JSON the SDK doesn't model
 * </pre>
 *
 * Events reach onEvent as the wire JSON ({@link Event}), whether the SDK knows the event
 * type or not. Compare on {@code event.type()}.
 */
public final class Common {
    private Common() {}

    /** The voice-agent-workshop folder (the one with tools/replay-server). */
    public static final Path PROJECT_ROOT = findRoot();

    public static final long KEEPALIVE_MS = 5000;
    /** How long a piped line waits for its reply before the next goes. */
    public static final long PIPED_REPLY_MS = 30_000;

    // The listen model. nova-3 (v1) runs on every Deepgram project, and it's the model the
    // Voice Agent docs show. The workshop site runs flux-general-en (v2), and the workshop
    // proxy only accepts that one. Set LISTEN_MODEL=flux-general-en and LISTEN_VERSION=v2
    // in .env to match the site on your own key.
    public static final String DEFAULT_LISTEN_MODEL = "nova-3";
    public static final String DEFAULT_LISTEN_VERSION = "v1";
    public static final String WORKSHOP_LISTEN_MODEL = "flux-general-en";
    public static final String WORKSHOP_LISTEN_VERSION = "v2";

    private static Path findRoot() {
        String given = System.getProperty("workshop.root");
        if (given != null && !given.isBlank()) return Paths.get(given).toAbsolutePath().normalize();
        Path start = Paths.get("").toAbsolutePath();
        for (Path p = start; p != null; p = p.getParent()) {
            if (Files.exists(p.resolve("tools/replay-server/harness.mjs"))) return p;
        }
        return start.getParent() != null ? start.getParent() : start;
    }

    /**
     * The {@code agent.listen.provider} block for missions that don't pick their own.
     * LISTEN_MODEL and LISTEN_VERSION override it. With a workshop token and no override,
     * it asks for the proxy's model, so no listen Warning comes back.
     */
    public static ObjectNode listenProvider() {
        String model = Env.pyStrip(Env.get("LISTEN_MODEL"));
        String version = Env.pyStrip(Env.get("LISTEN_VERSION"));
        if (model.isEmpty()) {
            boolean workshop = Credentials.usesWorkshop(null, null);
            model = workshop ? WORKSHOP_LISTEN_MODEL : DEFAULT_LISTEN_MODEL;
            if (version.isEmpty()) version = workshop ? WORKSHOP_LISTEN_VERSION : DEFAULT_LISTEN_VERSION;
        }
        ObjectNode provider = Json.obj("type", "deepgram", "model", model);
        if (!version.isEmpty()) provider.put("version", version);
        return provider;
    }

    /** An SDK client pointed at the plan's endpoint with its credential, on our transport. */
    static DeepgramClient makeClient(Credentials.Target target, RawTransport.Factory transport) {
        String rest = target.base().replaceFirst("^wss://", "https://").replaceFirst("^ws://", "http://");
        Environment environment = Environment.custom()
                .base("https://api.deepgram.com")
                .production("wss://api.deepgram.com")
                .agent(target.base())
                .agentRest(rest)
                .build();
        DeepgramClientBuilder builder = DeepgramClient.builder().environment(environment).transportFactory(transport);
        if (target.apiKey() != null) builder.apiKey(target.apiKey());
        else builder.accessToken(target.token());
        return builder.build();
    }

    /**
     * How runAsync runs. Common.run sets saveAudio and mission as make run does; the checks turn
     * typed turns off.
     */
    public static final class RunOptions {
        public String url;
        public String apiKey;
        /** null: typed turns on (from a terminal or a pipe); false: off. */
        public Boolean interactive;
        public Path saveAudio;
        public boolean quiet;
        public String mission;
        public boolean replay;
        // For tests: where lines come from and go, and how often KeepAlive goes out.
        public TypedLines input;
        public String typing;
        public PrintStream out = System.out;
        public long keepAliveMs = KEEPALIVE_MS;
        public long pingMs = RawTransport.PING_MS;
    }

    private static volatile Call current;

    /**
     * Connects, sends Settings when the server says Welcome, and hands every event to
     * {@code mission.onEvent} until the connection closes. Returns the Agent for inspection.
     *
     * @throws SetupError when the run can't start (no credentials, a refused connection)
     * @throws MissionError when your buildSettings or onEvent threw
     */
    public static Agent runAsync(Mission mission, RunOptions options) throws SetupError, InterruptedException {
        Env.load();
        Credentials.Target target = Credentials.plan(options.url, options.apiKey, options.mission);
        Call call = new Call(mission, options, target);
        current = call;
        try {
            return call.run();
        } finally {
            current = null;
        }
    }

    /**
     * Runs a mission: agent.Run calls this for make run NN, and a mission's own main calls it
     * from an IDE.
     */
    public static void run(Mission mission, String[] args) {
        utf8Output();
        Path save = PROJECT_ROOT.resolve("out").resolve("last-call.wav");
        String folder = Credentials.missionOf(mission.getClass());
        String nn = folder != null ? folder.substring(0, 2) : "NN";
        for (String arg : args) {
            if (arg.equals("--no-save")) {
                save = null;
            } else if (arg.equals("--mic")) {
                System.err.println("MIC=1 runs in Python: make run " + nn + " SDK=py MIC=1 (add MISSION_TARGET=solution "
                        + "to use the reference answer). In Java, type your turns.");
                System.exit(2);
            } else {
                System.err.println("Unknown option " + arg + ". The only option is --no-save (don't save the agent's voice "
                        + "to out/last-call.wav). Type a line and press Enter to talk.");
                System.exit(2);
            }
        }
        Env.load();
        String note = Credentials.credentialsNote();
        if (note != null) System.out.println(note);
        AtomicBoolean done = new AtomicBoolean();
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            // Ctrl-C: keep what the agent said so far, as Python's run does.
            if (done.get()) return;
            Call call = current;
            if (call != null) call.saveAudio();
            System.out.println();
            System.out.println("[bye]");
        }));
        RunOptions options = new RunOptions();
        options.saveAudio = save;
        options.mission = folder;
        int status;
        try {
            status = exitStatus(runAsync(mission, options));
        } catch (SetupError e) {
            System.err.println(e.getMessage());
            status = 2;
        } catch (MissionError e) {
            System.err.print(missionErrorTrace(e, nn));
            status = 1;
        } catch (InterruptedException e) {
            status = 1;
        }
        done.set(true);
        System.out.flush();
        System.exit(status);
    }

    // JAVA_TOOL_OPTIONS=-Dworkshop.fulltrace=true prints them all.
    /** How many frames of your program's exception make run prints. */
    static final int TRACE_FRAMES = 20;

    /**
     * Why a file couldn't be written, in words: "permission denied", the system's reason, or
     * the exception's message, never just the path again (Java's file errors carry only the
     * path as their message).
     */
    static String saveReason(IOException e) {
        if (e instanceof java.nio.file.AccessDeniedException) return "permission denied";
        if (e instanceof java.nio.file.FileAlreadyExistsException there) return there.getFile() + " is a file, not a folder";
        if (e instanceof java.nio.file.NoSuchFileException) return "that folder doesn't exist";
        if (e instanceof java.nio.file.FileSystemException f) {
            return f.getReason() != null ? f.getReason() : "the system gave no reason";
        }
        String message = e.getMessage();
        return message != null && !message.isBlank() ? message : "the system gave no reason";
    }

    /** How the save line ends: move a file that's in the way, else make the folder writable. */
    static String saveFix(IOException e) {
        return e instanceof java.nio.file.FileAlreadyExistsException
                ? ". Move or rename that file, then run this again."
                : ". Check that you can write to that folder, then run this again.";
    }

    /**
     * Your program's exception as make run NN prints it: the trace, redacted, as Python's
     * print_crash and TypeScript's describeError print theirs.
     */
    static String missionErrorTrace(MissionError e, String nn) {
        int frames = Boolean.getBoolean("workshop.fulltrace") ? Integer.MAX_VALUE : TRACE_FRAMES;
        return Redact.redact(trace(e.getCause(), frames, moreHint(nn)));
    }

    /** The end of the "... N more" line under make run NN: how to see every frame. */
    static String moreHint(String nn) {
        return " (to print them all: JAVA_TOOL_OPTIONS=-Dworkshop.fulltrace=true make run " + nn + " SDK=java)";
    }

    /**
     * An exception as Java prints it, cut to its first {@code frames} frames and a
     * "... N more" line that says how to see the rest ({@code moreHint}), so a
     * StackOverflowError is one screen, not a thousand lines. Causes and suppressed
     * exceptions follow, each once (a cause that loops back is named, not followed).
     */
    static String trace(Throwable err, int frames, String moreHint) {
        StringBuilder out = new StringBuilder();
        trace(err, frames, moreHint, "", "", java.util.Collections.newSetFromMap(new java.util.IdentityHashMap<>()), out);
        return out.toString();
    }

    private static void trace(Throwable err, int frames, String moreHint, String caption, String indent,
            java.util.Set<Throwable> seen, StringBuilder out) {
        if (!seen.add(err)) {
            out.append(indent).append(caption).append("[CIRCULAR REFERENCE: ").append(err).append("]\n");
            return;
        }
        out.append(indent).append(caption).append(err).append('\n');
        StackTraceElement[] stack = err.getStackTrace();
        for (int i = 0; i < Math.min(frames, stack.length); i++) out.append(indent).append("\tat ").append(stack[i]).append('\n');
        if (stack.length > frames) {
            out.append(indent).append("\t... ").append(stack.length - frames).append(" more").append(moreHint).append('\n');
        }
        for (Throwable s : err.getSuppressed()) trace(s, frames, moreHint, "Suppressed: ", indent + "\t", seen, out);
        if (err.getCause() != null) trace(err.getCause(), frames, moreHint, "Caused by: ", indent, seen, out);
    }

    /**
     * Prints UTF-8 whatever the locale says, as Python does: with LANG unset, Java's default
     * would print "¿Qué?" as "?Qu??". (JDK 19+ has -Dstdout.encoding; this works on 17.)
     */
    static void utf8Output() {
        System.setOut(new PrintStream(new FileOutputStream(FileDescriptor.out), true, StandardCharsets.UTF_8));
        System.setErr(new PrintStream(new FileOutputStream(FileDescriptor.err), true, StandardCharsets.UTF_8));
    }

    /**
     * The program's exit status: 1 when the workshop refused the session (an Error with
     * TALK_UNCONFIGURED, TALK_PAUSED, ONLINE_FULL or LIVE_CLOSED), else 0. A staff pause
     * mid-run (a TALK_PAUSED Warning) ends the run cleanly, with 0.
     */
    public static int exitStatus(Agent agent) {
        return "Error".equals(agent.stopType) && agent.stopCode != null && Lines.REFUSAL_CODES.contains(agent.stopCode) ? 1 : 0;
    }

    /** One conversation: the SDK socket, the event thread, typed turns and the WAV. */
    private static final class Call {
        private final Mission mission;
        private final RunOptions o;
        private final Credentials.Target target;
        private final RawTransport.Factory factory;
        private final V1WebSocketClient socket;
        private final Agent agent;
        private final WavSink sink;
        private final String typing;
        private final ExecutorService events = Executors.newSingleThreadExecutor(daemon("agent-events"));
        private final ScheduledExecutorService ticker = Executors.newSingleThreadScheduledExecutor(daemon("agent-keepalive"));
        private final CompletableFuture<Agent> result = new CompletableFuture<>();
        private volatile boolean finished;
        private volatile boolean saidBye;
        private volatile boolean applied;
        private final AtomicBoolean audioSaved = new AtomicBoolean();

        Call(Mission mission, RunOptions o, Credentials.Target target) {
            this.mission = mission;
            this.o = o;
            this.target = target;
            this.factory = new RawTransport.Factory(o.pingMs);
            this.typing = Boolean.FALSE.equals(o.interactive) ? null : (o.typing != null ? o.typing : TypedLines.inputMode());
            this.sink = o.saveAudio != null ? new WavSink(o.saveAudio) : null;
            this.socket = makeClient(target, factory).agent().v1().v1WebSocket();
            this.agent = new Agent(socket, factory::last, () -> post(this::hangUpNow), o.out, o.quiet);
        }

        private static java.util.concurrent.ThreadFactory daemon(String name) {
            return r -> {
                Thread t = new Thread(r, name);
                t.setDaemon(true);
                return t;
            };
        }

        private void post(Runnable work) {
            try {
                events.execute(() -> {
                    if (finished) return;
                    try {
                        work.run();
                    } catch (MissionError e) {
                        fail(e);
                    } catch (Throwable e) {
                        // An Error too (an AssertionError, a StackOverflowError): the run ends,
                        // never hangs.
                        fail(new MissionError(e));
                    }
                });
            } catch (java.util.concurrent.RejectedExecutionException e) {
                // The call has ended.
            }
        }

        Agent run() throws SetupError, InterruptedException {
            socket.reconnectOptions(RawTransport.NO_RECONNECTS);
            socket.onMessage(text -> post(() -> onText(text)));
            socket.onAgentV1Audio(bytes -> {
                byte[] chunk = bytes.toByteArray();
                post(() -> onAudio(chunk));
            });
            socket.onError(e -> {}); // a refused or failed connect is read below; a drop comes through onEnd
            factory.onEnd((code, reason) -> post(() -> onEnd(code, reason)));
            Thread turns = null;
            try {
                try {
                    socket.connect().get(30, TimeUnit.SECONDS);
                } catch (IllegalArgumentException e) {
                    // The backstop for Credentials.validAddress (a malformed IPv6 literal, say).
                    // The SDK's message names the endpoint, which belongs out of logs: name the
                    // variable instead.
                    throw new SetupError(target.workshop() ? Credentials.BAD_WORKSHOP_URL : Credentials.BAD_AGENT_URL,
                            false);
                } catch (ExecutionException e) {
                    Integer status = factory.failureStatus();
                    if (status != null) {
                        throw new SetupError(Lines.refusedLine(status, target.workshop()), Lines.retryableStatus(status));
                    }
                    throw new SetupError(Lines.unreachableLine(e.getCause(), target.workshop()), true);
                } catch (TimeoutException e) {
                    throw new SetupError(Lines.unreachableLine(e, target.workshop()), true);
                }
                // No audio flows from this program, so KeepAlive holds the connection open.
                ticker.scheduleAtFixedRate(() -> post(() -> {
                    if (agent.ready && !agent.closed) agent.keepAlive();
                }), o.keepAliveMs, o.keepAliveMs, TimeUnit.MILLISECONDS);
                BlockingQueue<String> lines = new LinkedBlockingQueue<>();
                if (typing != null) {
                    TypedLines input = o.input != null ? o.input : TypedLines.stdin();
                    input.attach(lines);
                    turns = new Thread(() -> typedTurns(lines), "typed-turns");
                    turns.setDaemon(true);
                    turns.start();
                }
                try {
                    return result.get();
                } catch (ExecutionException e) {
                    if (e.getCause() instanceof MissionError m) throw m;
                    throw new MissionError(e.getCause());
                }
            } finally {
                finished = true;
                if (o.input != null) o.input.detach();
                else if (typing != null) TypedLines.stdin().detach();
                if (turns != null) turns.interrupt();
                ticker.shutdownNow();
                events.shutdownNow();
                socket.disconnect();
                factory.shutdown();
                saveAudio();
            }
        }

        /** Writes out/last-call.wav once, or says no audio came. */
        void saveAudio() {
            if (sink == null || !audioSaved.compareAndSet(false, true)) return;
            try {
                Path saved = sink.close();
                if (saved != null && !o.quiet) {
                    Path shown = saved.toAbsolutePath().startsWith(PROJECT_ROOT) ? PROJECT_ROOT.relativize(saved.toAbsolutePath()) : saved;
                    o.out.println("[saved] the agent's voice is in " + shown);
                } else if (saved == null && applied && !o.quiet) {
                    o.out.println(Lines.NO_AUDIO_LINE);
                }
            } catch (IOException e) {
                o.out.println("Couldn't save the agent's voice to " + o.saveAudio + ": " + saveReason(e) + saveFix(e));
            }
        }

        private void onAudio(byte[] chunk) {
            if (sink != null) sink.write(chunk);
        }

        private void onText(String text) {
            Event event = Event.parse(text);
            if (event == null) return;
            String kind = event.type();
            String code = event.str("code");
            if (("Error".equals(kind) || "Warning".equals(kind)) && code != null && Lines.STOP_CODES.contains(code)) {
                agent.stopCode = code;
                agent.stopType = kind;
            } else if ("ConversationText".equals(kind) && "assistant".equals(event.str("role"))
                    && ("sent".equals(agent.turn) || ("calling".equals(agent.turn) && agent.callsOpen == 0
                            && !agent.injected.contains(String.valueOf(event.str("content")).strip())))) {
                agent.turn = "spoken"; // this line's reply; its AgentAudioDone ends the turn
            } else if ("FunctionCallRequest".equals(kind)
                    && ("sent".equals(agent.turn) || "spoken".equals(agent.turn) || "calling".equals(agent.turn))) {
                // The turn ends on the reply after your answer, not on a filler's audio.
                long calls = event.items("functions").stream().filter(f -> f.bool("client_side", true)).count();
                if (calls > 0) {
                    agent.callsOpen += (int) calls;
                    agent.turn = "calling";
                }
            } else if ("AgentAudioDone".equals(kind) && ("greeting".equals(agent.turn) || "spoken".equals(agent.turn))) {
                agent.replyDone.set();
            }
            if ("Welcome".equals(kind)) {
                ObjectNode settings;
                try {
                    settings = mission.buildSettings();
                } catch (RuntimeException | Error e) {
                    throw new MissionError(e);
                }
                if (sink != null) sink.sampleRate(settings.path("audio").path("output").path("sample_rate").asInt(24000));
                if ("piped".equals(typing) && !settings.path("agent").path("greeting").asText("").isBlank()) {
                    // The greeting plays first: the first piped line waits for it to finish.
                    agent.replyDone.clear();
                    agent.turn = "greeting";
                }
                agent.sendSettings(settings);
            } else if ("SettingsApplied".equals(kind)) {
                agent.markReady();
                applied = true;
            }
            if (!o.quiet) {
                String line = Lines.eventLine(event, o.replay, typing);
                if (line != null) o.out.println(line);
            }
            agent.inOnEvent = true;
            try {
                mission.onEvent(agent, event);
            } catch (Exception | Error e) {
                throw new MissionError(e);
            } finally {
                agent.inOnEvent = false;
            }
            if (agent.closed) {
                // Your program hung up (end_call answered, say): one closing line, so the run
                // doesn't look like it stopped on its own.
                if (agent.hungUp && !saidBye && !o.quiet && !o.replay) o.out.println(Lines.HUNG_UP_LINE);
                hangUpNow();
            }
        }

        /** Closes the connection (1000) and ends the run once the server answers, or after 1 s. */
        private void hangUpNow() {
            agent.closed = true;
            RawTransport.Transport t = factory.last();
            socket.disconnect();
            if (t != null) {
                try {
                    t.awaitEnd(1000);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
            finish();
        }

        private void onEnd(int code, String reason) {
            agent.closeCode = code;
            agent.closeReason = reason;
            // A stop code already printed its line; the close after it says nothing new.
            if (!o.quiet && code != 1000 && agent.stopCode == null) {
                o.out.println(("[closed] " + code + " " + reason).stripTrailing());
            }
            finish();
        }

        private void finish() {
            agent.closed = true;
            finished = true;
            result.complete(agent);
        }

        private void fail(MissionError e) {
            if (finished) return;
            finished = true;
            agent.closed = true;
            socket.disconnect();
            result.completeExceptionally(e);
        }

        private void typedTurns(BlockingQueue<String> lines) {
            try {
                while (true) {
                    String line = lines.take();
                    while (!agent.awaitReady(200)) {
                        if (finished) return;
                    }
                    if ("piped".equals(typing) && agent.turn != null) {
                        // The greeting first, then each reply, or PIPED_REPLY_MS.
                        agent.replyDone.await(PIPED_REPLY_MS);
                        agent.turn = null;
                    }
                    if (agent.closed || finished) return;
                    if (line == TypedLines.END) {
                        // End of input (Ctrl-D, or the last piped line answered): hang up.
                        post(() -> {
                            if (!o.quiet) o.out.println(Lines.END_OF_INPUT_LINE);
                            saidBye = true;
                            agent.close();
                        });
                        return;
                    }
                    CompletableFuture<Void> sentIt = new CompletableFuture<>();
                    post(() -> {
                        if ("piped".equals(typing)) {
                            // One piped line at a time: the next waits for this one's reply.
                            agent.replyDone.clear();
                            agent.turn = "sent";
                            agent.callsOpen = 0;
                            agent.injected.clear();
                        }
                        agent.injectUserMessage(line);
                        sentIt.complete(null);
                    });
                    try {
                        sentIt.get(PIPED_REPLY_MS, TimeUnit.MILLISECONDS);
                    } catch (ExecutionException | TimeoutException e) {
                        return;
                    }
                }
            } catch (InterruptedException e) {
                // The call ended.
            }
        }
    }
}
