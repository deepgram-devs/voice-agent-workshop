package agent;

import com.deepgram.core.ObjectMappers;
import com.deepgram.resources.agent.v1.types.AgentV1InjectAgentMessage;
import com.deepgram.resources.agent.v1.types.AgentV1InjectUserMessage;
import com.deepgram.resources.agent.v1.types.AgentV1KeepAlive;
import com.deepgram.resources.agent.v1.types.AgentV1SendFunctionCallResponse;
import com.deepgram.resources.agent.v1.types.AgentV1Settings;
import com.deepgram.resources.agent.v1.types.AgentV1UpdatePrompt;
import com.deepgram.resources.agent.v1.types.AgentV1UpdateSpeak;
import com.deepgram.resources.agent.v1.types.AgentV1UpdateThink;
import com.deepgram.resources.agent.v1.websocket.V1WebSocketClient;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.io.PrintStream;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;
import java.util.function.Supplier;
import okio.ByteString;

/** One live conversation. Missions call these; each one sends one message. */
public class Agent {
    private static final ObjectMapper SDK_JSON = ObjectMappers.JSON_MAPPER;

    private final V1WebSocketClient socket;
    private final Supplier<RawTransport.Transport> transport;
    private final Runnable hangUp;
    private final PrintStream out;
    private final boolean quiet;
    private final Set<String> rawNoticeShown = new HashSet<>();
    private final CountDownLatch readyLatch = new CountDownLatch(1);

    /** True once SettingsApplied arrived: audio, typed turns and KeepAlive may go out. */
    public volatile boolean ready;
    public volatile boolean closed;
    /** True when your program called close(). */
    public volatile boolean hungUp;
    /** How the server closed the call, when it did (1006: the network dropped). */
    public volatile Integer closeCode;
    public volatile String closeReason = "";
    /** A STOP_CODES code from an Error or Warning, if one came, and which frame carried it. */
    public volatile String stopCode;
    public volatile String stopType;
    /** The Settings you sent, as JSON. */
    public volatile ObjectNode settings;

    // Piped turns: which agent turn the run waits on. null: none; "greeting": the greeting's
    // audio; "sent": a piped line, no reply yet; "calling": a client-side function call is
    // open; "spoken": its reply came, its audio is still going. replyDone is set when that
    // turn's AgentAudioDone arrives.
    volatile String turn;
    final Flag replyDone = new Flag();
    volatile int callsOpen;
    final List<String> injected = new ArrayList<>();
    volatile boolean inOnEvent;

    Agent(V1WebSocketClient socket, Supplier<RawTransport.Transport> transport, Runnable hangUp, PrintStream out, boolean quiet) {
        this.socket = socket;
        this.transport = transport;
        this.hangUp = hangUp;
        this.out = out;
        this.quiet = quiet;
    }

    // -- the one escape hatch -------------------------------------------------

    /** Sends any JSON message as is. Use it for fields or values the SDK doesn't model. */
    public void sendRaw(ObjectNode message) {
        RawTransport.Transport t = transport.get();
        if (t == null) throw new IllegalStateException("not connected");
        sent(t.sendText(Json.write(message)));
    }

    /**
     * Sends a message through the SDK's type for it. If this SDK release can't carry the
     * message unchanged (a provider type newer than the SDK, say), sends the same JSON raw
     * with a one-line note instead of failing. A field you set to null goes out raw with no
     * note: the SDK's types leave nulls off the wire, and Python's SDK sends them.
     */
    private <T> void sendTyped(Class<T> model, ObjectNode payload, Function<T, CompletableFuture<Void>> send) {
        T typed = null;
        boolean onlyNulls = false;
        try {
            T candidate = typedValue(model, payload);
            JsonNode back = SDK_JSON.valueToTree(candidate);
            if (Json.sameJson(payload, back)) typed = candidate;
            else onlyNulls = Json.sameJson(Json.withoutNulls(payload), back);
        } catch (Exception e) {
            // Not modelled: raw below.
        }
        if (typed != null) {
            sent(send.apply(typed));
            return;
        }
        if (onlyNulls) {
            sendRaw(payload); // the SDK models it all; raw only so the null stays on the wire
            return;
        }
        String kind = payload.path("type").asText(model.getSimpleName());
        if (rawNoticeShown.add(kind) && !quiet) {
            out.println("[note] " + kind + " sent as raw JSON: this SDK release has no field for part of it (the check reads it the same)");
        }
        sendRaw(payload);
    }

    /**
     * {@code payload} as the SDK's type. Its types write some keys themselves (each "type"
     * constant) and also keep the input's copy as an extra property, so the SDK's text
     * would have that key twice. Each pass drops from the input the keys the text repeats.
     */
    private static <T> T typedValue(Class<T> model, ObjectNode payload) throws IOException {
        ObjectNode input = payload.deepCopy();
        for (int pass = 0; pass < 2; pass++) {
            T value = SDK_JSON.treeToValue(input, model);
            List<List<Object>> repeated = Json.repeatedKeys(SDK_JSON.writeValueAsString(value));
            if (repeated.isEmpty()) return value;
            for (List<Object> path : repeated) {
                if (!Json.removeAt(input, path)) throw new IOException("a repeated key at " + path);
            }
        }
        throw new IOException("repeated keys in the SDK's text");
    }

    /** A send the connection refused because it closed already: nothing left to send to. */
    private void sent(CompletableFuture<Void> future) {
        try {
            future.join();
        } catch (CompletionException e) {
            RawTransport.Transport t = transport.get();
            if (t != null && !t.isOpen()) return;
            throw e;
        }
    }

    // -- senders ---------------------------------------------------------------

    public void sendSettings(ObjectNode settings) {
        ObjectNode message = Json.obj("type", "Settings");
        message.setAll(settings.deepCopy());
        message.put("type", "Settings");
        this.settings = message;
        sendTyped(AgentV1Settings.class, message, socket::sendSettings);
    }

    /** Adds to the prompt: send only the new lines. */
    public void updatePrompt(String prompt) {
        sendTyped(AgentV1UpdatePrompt.class, Json.obj("type", "UpdatePrompt", "prompt", prompt), socket::sendUpdatePrompt);
    }

    public void updateSpeak(ObjectNode speak) {
        sendTyped(AgentV1UpdateSpeak.class, Json.obj("type", "UpdateSpeak", "speak", speak), socket::sendUpdateSpeak);
    }

    /** Swaps the whole think block mid-call (provider, prompt, functions). */
    public void updateThink(ObjectNode think) {
        sendTyped(AgentV1UpdateThink.class, Json.obj("type", "UpdateThink", "think", think), socket::sendUpdateThink);
    }

    public void injectAgentMessage(String message) {
        injectAgentMessage(message, null);
    }

    public void injectAgentMessage(String message, String behavior) {
        ObjectNode payload = Json.obj("type", "InjectAgentMessage", "message", message);
        injected.add(message.strip());
        if (behavior != null && !behavior.isEmpty()) payload.put("behavior", behavior);
        sendTyped(AgentV1InjectAgentMessage.class, payload, socket::sendInjectAgentMessage);
    }

    public void injectUserMessage(String content) {
        sendTyped(AgentV1InjectUserMessage.class, Json.obj("type", "InjectUserMessage", "content", content),
                socket::sendInjectUserMessage);
    }

    public void functionCallResponse(String id, String name, String content) {
        ObjectNode payload = Json.obj("type", "FunctionCallResponse", "id", id, "name", name, "content", content);
        callsOpen = Math.max(0, callsOpen - 1);
        sendTyped(AgentV1SendFunctionCallResponse.class, payload, socket::sendFunctionCallResponse);
    }

    public void keepAlive() {
        sent(socket.sendKeepAlive(AgentV1KeepAlive.builder().build()));
    }

    public void sendAudio(byte[] chunk) {
        sent(socket.sendMedia(ByteString.of(chunk)));
    }

    /**
     * Hangs up. From onEvent (where every mission calls it) the run hangs up when onEvent
     * returns; from any other thread it hangs up now, or, while onEvent is running, when it
     * returns.
     */
    public void close() {
        if (closed) return;
        closed = true;
        hungUp = true;
        if (!inOnEvent) hangUp.run();
    }

    /** Waits for SettingsApplied, at most {@code ms}; true once it came. */
    public boolean awaitReady(long ms) throws InterruptedException {
        return readyLatch.await(ms, TimeUnit.MILLISECONDS);
    }

    void markReady() {
        ready = true;
        readyLatch.countDown();
    }

    /** A flag one thread sets and another waits on. */
    static final class Flag {
        private boolean set;

        synchronized void set() {
            set = true;
            notifyAll();
        }

        synchronized void clear() {
            set = false;
        }

        synchronized boolean await(long ms) throws InterruptedException {
            long until = System.currentTimeMillis() + ms;
            while (!set) {
                long left = until - System.currentTimeMillis();
                if (left <= 0) return false;
                wait(left);
            }
            return true;
        }
    }
}
