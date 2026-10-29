// The smallest Voice Agent program on the Deepgram Java SDK, with no helpers.
//
// It sends Settings, waits for SettingsApplied before it sends anything else, lets you type
// turns, and saves the agent's voice to out/last-call.wav, as `make run` does. The missions do
// the same through java/src/main/java/agent, which adds the workshop token path, error hints
// and the offline checks; read this file to see the SDK calls on their own.
//
// Run it from java/:   sh mission.sh example [path/to/voice.wav]
// It reads DEEPGRAM_API_KEY from ../.env or the shell. Type a line and press Enter;
// Ctrl-C hangs up. DEEPGRAM_AGENT_URL picks another agent host (the offline test uses it).

import com.deepgram.DeepgramClient;
import com.deepgram.DeepgramClientBuilder;
import com.deepgram.core.Environment;
import com.deepgram.core.ObjectMappers;
import com.deepgram.core.ReconnectingWebSocketListener.ReconnectOptions;
import com.deepgram.resources.agent.v1.types.AgentV1InjectUserMessage;
import com.deepgram.resources.agent.v1.types.AgentV1KeepAlive;
import com.deepgram.resources.agent.v1.types.AgentV1Settings;
import com.deepgram.resources.agent.v1.websocket.V1WebSocketClient;
import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import okhttp3.OkHttpClient;

public class FirstSettings {
    static final int OUTPUT_RATE = 24000;

    // The Settings message as JSON, read into the SDK's type, which validates it and sends it.
    // The SDK's type writes "type" for the message and for the listen provider itself, so this
    // JSON leaves those two out and each goes on the wire once.
    static final String SETTINGS = """
            {
              "audio": {
                "input": {"encoding": "linear16", "sample_rate": 16000},
                "output": {"encoding": "linear16", "sample_rate": 24000, "container": "none"}
              },
              "agent": {
                "listen": {"provider": {"model": "nova-3", "version": "v1"}},
                "think": {"provider": {"type": "open_ai", "model": "gpt-4o-mini"}, "prompt": "You are a friendly voice agent. Keep replies short."},
                "speak": {"provider": {"type": "deepgram", "model": "flux-hannah-en", "version": "v2"}},
                "greeting": "Hi there. Type something and I will answer."
              }
            }
            """;

    public static void main(String[] args) throws Exception {
        // UTF-8 out whatever the locale says: with LANG unset, Java would print "¿Qué?" as
        // "?Qu??".
        System.setOut(new PrintStream(new FileOutputStream(FileDescriptor.out), true, StandardCharsets.UTF_8));
        System.setErr(new PrintStream(new FileOutputStream(FileDescriptor.err), true, StandardCharsets.UTF_8));
        Path root = Paths.get("").toAbsolutePath().getParent(); // run from java/
        Path wav = args.length > 0 ? Paths.get(args[0]) : root.resolve("out").resolve("last-call.wav");
        Map<String, String> env = dotenv(root.resolve(".env"));
        env.putAll(System.getenv()); // the shell wins
        String key = strip(env.getOrDefault("DEEPGRAM_API_KEY", ""));
        if (key.isEmpty()) {
            // The same two states as the missions' line (agent.Credentials), in this example's own
            // words: it reads the key only; the helpers add the workshop token path.
            System.err.println(Files.isRegularFile(root.resolve(".env"))
                    ? "DEEPGRAM_API_KEY is empty in .env (this folder). Set it: this example "
                            + "runs on your own key only (make run takes a workshop token too). "
                            + "make check NN runs offline with no key."
                    : "No Deepgram credentials. Copy .env.example to .env and set "
                            + "DEEPGRAM_API_KEY (free key: https://console.deepgram.com/signup): "
                            + "this example runs on your own key only "
                            + "(make run takes a workshop token too).");
            System.exit(2);
        }
        // Printable ASCII only: a header can't carry a curly quote, and a space is a paste error.
        if (!key.chars().allMatch(c -> c >= 0x21 && c <= 0x7E)) {
            System.err.println("DEEPGRAM_API_KEY has a character a key can't have (a curly quote or a hidden space, "
                    + "often from copy and paste). Copy it again as plain text.");
            System.exit(2);
        }

        // A 20 s WebSocket ping, as Python's websockets has: a dead network ends the call.
        DeepgramClientBuilder builder = DeepgramClient.builder().apiKey(key).httpClient(new OkHttpClient.Builder()
                .readTimeout(0, TimeUnit.MILLISECONDS).pingInterval(20, TimeUnit.SECONDS).build());
        String host = strip(env.getOrDefault("DEEPGRAM_AGENT_URL", "")).replaceAll("/+$", "").replaceAll("/v1/agent/converse$", "");
        if (!host.isEmpty()) {
            String rest = host.replaceFirst("^wss://", "https://").replaceFirst("^ws://", "http://");
            builder.environment(Environment.custom().base("https://api.deepgram.com").production("wss://api.deepgram.com")
                    .agent(host).agentRest(rest).build());
        } // else production: wss://agent.deepgram.com
        V1WebSocketClient socket = builder.build().agent().v1().v1WebSocket();
        // One connection: the SDK's default reconnects forever, and a new socket would need
        // Settings again.
        socket.reconnectOptions(ReconnectOptions.builder().maxRetries(0).build());

        CountDownLatch ready = new CountDownLatch(1); // counted down when SettingsApplied arrives
        CountDownLatch closed = new CountDownLatch(1);
        AtomicBoolean connected = new AtomicBoolean();
        ByteArrayOutputStream audio = new ByteArrayOutputStream();

        // Events arrive on the SDK's thread, typed.
        socket.onSettingsApplied(applied -> {
            ready.countDown();
            System.out.println("[ready] type a line and press Enter");
        });
        socket.onConversationText(text -> System.out.println(text.getRole() + ": " + text.getContent()));
        socket.onErrorMessage(error -> System.out.println("Agent error: " + error.getDescription() + " (" + error.getCode() + ")"));
        socket.onAgentV1Audio(bytes -> {
            synchronized (audio) {
                audio.writeBytes(bytes.toByteArray()); // the agent's voice: linear16 at 24 kHz
            }
        });
        socket.onDisconnected(reason -> {
            if (reason.getCode() != 1000) System.out.println("[closed] " + reason.getCode() + " " + reason.getReason());
            closed.countDown();
        });
        // A drop (no close frame) arrives as an error only, as does an event type newer than
        // this SDK ("Unrecognized WebSocket message"), which isn't the end of the call.
        socket.onError(error -> {
            if (connected.get() && !String.valueOf(error.getMessage()).contains("Unrecognized WebSocket message")) {
                System.out.println("[closed] 1006 no close frame");
                closed.countDown();
            }
        });
        AtomicBoolean ended = new AtomicBoolean(); // set before every exit of our own: not Ctrl-C
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            save(wav, audio);
            if (!ended.get()) {
                System.out.println();
                System.out.println("[bye]"); // Ctrl-C, as Python's example says
            }
        }));

        try {
            socket.connect().get(30, TimeUnit.SECONDS);
            connected.set(true);
        } catch (Exception e) {
            // Print the status only: never the request, which carries the key. Otherwise the
            // helpers' one line (agent.Lines.unreachableLine), read from the cause chain.
            Matcher status = Pattern.compile("with HTTP (\\d{3})|but was '(\\d{3})").matcher(messages(e));
            System.err.println(status.find()
                    ? "Deepgram refused the connection (HTTP " + (status.group(1) != null ? status.group(1) : status.group(2)) + ")."
                    : unreachable(e));
            ended.set(true);
            System.exit(2);
        }

        // 1. Settings first, before any audio or text: the agent ignores everything until then.
        socket.sendSettings(ObjectMappers.JSON_MAPPER.readValue(SETTINGS, AgentV1Settings.class));

        // 2. Nothing else goes out until SettingsApplied: typed turns, then KeepAlive every 5 s
        //    (no audio flows from this program, so KeepAlive holds the line open).
        Thread typing = new Thread(() -> {
            try (BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8))) {
                ready.await();
                String line;
                while ((line = in.readLine()) != null) {
                    if (!line.isBlank()) {
                        socket.sendInjectUserMessage(AgentV1InjectUserMessage.builder().content(line.strip()).build());
                    }
                }
            } catch (IOException | InterruptedException e) {
                // The input or the program ended.
            }
        });
        typing.setDaemon(true);
        typing.start();
        ScheduledExecutorService keepAlive = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r);
            t.setDaemon(true);
            return t;
        });
        keepAlive.scheduleAtFixedRate(() -> {
            if (ready.getCount() == 0) socket.sendKeepAlive(AgentV1KeepAlive.builder().build());
        }, 5, 5, TimeUnit.SECONDS);

        closed.await(); // 3. until the agent closes the call (or Ctrl-C)
        socket.disconnect();
        ended.set(true);
        System.exit(0); // saves the WAV (the shutdown hook) and ends OkHttp's threads
    }

    /** Every message in an exception's cause chain, for the status the SDK puts in one of them. */
    static String messages(Throwable e) {
        StringBuilder all = new StringBuilder();
        for (Throwable t = e; t != null; t = t.getCause()) all.append(t.getMessage()).append('\n');
        return all.toString();
    }

    /**
     * The helpers' line for a connection that never opened (agent.Lines.unreachableLine), read
     * from the cause chain.
     */
    static String unreachable(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            String text = String.valueOf(t.getMessage());
            if (t instanceof java.net.ConnectException || text.contains("Connection refused") || text.contains("ConnectException")) {
                return "Could not reach the agent: connection refused. Check DEEPGRAM_AGENT_URL.";
            }
            if (t instanceof java.net.UnknownHostException || text.contains("UnknownHostException")) {
                return "Could not reach the agent: no such host. Check DEEPGRAM_AGENT_URL.";
            }
            if (t instanceof java.net.SocketTimeoutException || t instanceof java.util.concurrent.TimeoutException
                    || text.contains("SocketTimeoutException")) {
                return "Could not reach the agent: it timed out. Check DEEPGRAM_AGENT_URL.";
            }
            if (t.getCause() == null) {
                return "Could not reach the agent: " + t.getClass().getSimpleName() + ". Check DEEPGRAM_AGENT_URL.";
            }
        }
        return "Could not reach the agent. Check DEEPGRAM_AGENT_URL.";
    }

    static void save(Path path, ByteArrayOutputStream audio) {
        byte[] data;
        synchronized (audio) {
            data = audio.toByteArray();
        }
        if (data.length == 0) return;
        ByteBuffer header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN);
        header.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(36 + data.length).put("WAVE".getBytes(StandardCharsets.US_ASCII));
        header.put("fmt ".getBytes(StandardCharsets.US_ASCII)).putInt(16).putShort((short) 1).putShort((short) 1); // PCM, mono
        header.putInt(OUTPUT_RATE).putInt(OUTPUT_RATE * 2).putShort((short) 2).putShort((short) 16); // linear16
        header.put("data".getBytes(StandardCharsets.US_ASCII)).putInt(data.length);
        try {
            Files.createDirectories(path.toAbsolutePath().getParent());
            Files.write(path, header.array());
            Files.write(path, data, java.nio.file.StandardOpenOption.APPEND);
            System.out.println("[saved] the agent's voice is in " + path);
        } catch (IOException e) {
            // Java's file errors carry only the path as their message: say why in words.
            String why = e instanceof java.nio.file.AccessDeniedException ? "permission denied"
                    : e instanceof java.nio.file.FileAlreadyExistsException there ? there.getFile() + " is a file, not a folder"
                    : e instanceof java.nio.file.NoSuchFileException ? "that folder doesn't exist"
                    : e instanceof java.nio.file.FileSystemException fs && fs.getReason() != null ? fs.getReason()
                    : !(e instanceof java.nio.file.FileSystemException) && e.getMessage() != null && !e.getMessage().isBlank()
                            ? e.getMessage()
                    : "the system gave no reason";
            System.out.println("Couldn't save the agent's voice to " + path + ": " + why
                    + (e instanceof java.nio.file.FileAlreadyExistsException
                            ? ". Move or rename that file, then run this again."
                            : ". Check that you can write to that folder, then run this again."));
        }
    }

    /** .env's variables; a missing file is empty, and one that isn't UTF-8 gets one line. */
    static Map<String, String> dotenv(Path file) {
        try {
            return parse(Files.readString(file, StandardCharsets.UTF_8), System.err::println);
        } catch (java.nio.charset.CharacterCodingException e) {
            System.err.println(".env isn't UTF-8 text, so none of it was read. Save it as UTF-8 (plain text), then run this again.");
        } catch (IOException e) {
            // No .env: the shell's variables only.
        }
        return new HashMap<>();
    }

    // The .env rules of python-dotenv 1.2.4, as java/src/main/java/agent/Env.java reads them,
    // copied here so this example needs no helpers (ExamplesTest keeps the two the same). Lines
    // end at LF, CRLF or CR. A key is 'quoted', or doesn't start with a single quote and has no
    // =, # or blanks; a line with a key and no = unsets that key. An unquoted value ends at a
    // blank and #; a quoted value ends at its closing quote, with only a comment after it, else
    // the line is dropped with a line saying so; double quotes take the backslash escapes,
    // single quotes only \\ and \'. "Blank" is what Python's \s matches. Not supported: a
    // quote, in a key or a value, over a line ending; and ${VAR} (never expanded here).
    static final String WS_CHARS = "\\t\\n\\x0B\\f\\r\\x1C-\\x1F \\x85\\xA0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000";
    static final String WS = "[" + WS_CHARS + "]";
    static final Pattern LINE = Pattern.compile(
            "^" + WS + "*(?>(?:export" + WS + "+)?)(?:'([^']+)'|([^'=#" + WS_CHARS + "][^=#" + WS_CHARS + "]*))" + WS + "*=(.*)$",
            Pattern.DOTALL);
    static final Pattern BARE = Pattern.compile(
            "^" + WS + "*(?>(?:export" + WS + "+)?)(?:'([^']+)'|([^'=#" + WS_CHARS + "][^=#" + WS_CHARS + "]*))" + WS + "*(#.*)?$",
            Pattern.DOTALL);

    static final Pattern BLANK_OR_COMMENT = Pattern.compile("^" + WS + "*(#.*)?$", Pattern.DOTALL);

    /** Trims the blanks Python's .strip() trims, as the helpers do. */
    static String strip(String s) {
        return s.replaceAll("^" + WS + "+|" + WS + "+$", "");
    }

    static Map<String, String> parse(String text, java.util.function.Consumer<String> problem) {
        Map<String, String> values = new HashMap<>();
        if (text.startsWith("\uFEFF")) text = text.substring(1);
        String[] lines = text.split("\\r\\n|\\r|\\n");
        for (int n = 0; n < lines.length; n++) {
            Matcher m = LINE.matcher(lines[n]);
            if (!m.matches()) {
                Matcher bare = BARE.matcher(lines[n]);
                if (bare.matches()) {
                    values.remove(bare.group(1) != null ? bare.group(1) : bare.group(2));
                } else if (!BLANK_OR_COMMENT.matcher(lines[n]).matches()) {
                    problem.accept(".env line " + (n + 1) + " couldn't be read: it isn't KEY=value. Fix that line, then run "
                            + "this again.");
                }
                continue;
            }
            String key = m.group(1) != null ? m.group(1) : m.group(2);
            String rest = m.group(3);
            String v = rest.replaceAll("^" + WS + "+", "");
            if (v.isEmpty() || (v.charAt(0) != '"' && v.charAt(0) != '\'')) {
                Matcher u = Pattern.compile("^(.*?)(" + WS + "+#.*)?$", Pattern.DOTALL).matcher(rest);
                u.matches();
                values.put(key, strip(u.group(1)));
                continue;
            }
            char q = v.charAt(0);
            String escapes = q == '"' ? "\\\"'abfnrtv" : "\\'";
            StringBuilder inside = new StringBuilder();
            boolean read = false;
            for (int i = 1; i < v.length(); i++) {
                char c = v.charAt(i);
                if (c == '\\' && i + 1 < v.length() && escapes.indexOf(v.charAt(i + 1)) >= 0) {
                    char e = v.charAt(++i);
                    inside.append(switch (e) {
                        case 'a' -> '\u0007';
                        case 'b' -> '\b';
                        case 'f' -> '\f';
                        case 'n' -> '\n';
                        case 'r' -> '\r';
                        case 't' -> '\t';
                        case 'v' -> '\u000B';
                        default -> e;
                    });
                } else if (c == q) {
                    read = Pattern.compile(WS + "*(#.*)?", Pattern.DOTALL).matcher(v.substring(i + 1)).matches();
                    break;
                } else {
                    inside.append(c);
                }
            }
            if (read) {
                values.put(key, inside.toString());
            } else {
                problem.accept(".env line " + (n + 1) + " couldn't be read: its quote never closes, or text follows the "
                        + "closing quote. Fix that line, then run this again.");
            }
        }
        return values;
    }
}
