package agent;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.function.BiConsumer;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okhttp3.mockwebserver.Dispatcher;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;

/**
 * A stand-in agent endpoint on MockWebServer: Welcome on open, SettingsApplied after
 * Settings, and every client frame recorded. {@link #onFrame} scripts the rest.
 */
final class FakeAgent implements AutoCloseable {
    final MockWebServer server = new MockWebServer();
    /** Every text frame the client sent, in order. */
    final List<String> frames = new CopyOnWriteArrayList<>();
    final BlockingQueue<String> arrivals = new LinkedBlockingQueue<>();
    volatile Integer clientCloseCode;
    volatile int refuseWith;
    volatile boolean welcome = true;
    volatile long appliedDelayMs;
    /** Runs for each client text frame, after it's recorded: (socket, frame). */
    volatile BiConsumer<WebSocket, JsonNode> onFrame = (ws, frame) -> {};
    /** Runs once SettingsApplied went out. */
    volatile java.util.function.Consumer<WebSocket> afterApplied = ws -> {};

    FakeAgent() throws IOException {
        server.setDispatcher(new Dispatcher() {
            @Override
            public MockResponse dispatch(RecordedRequest request) {
                if (refuseWith > 0) return new MockResponse().setResponseCode(refuseWith).setBody("{\"err_code\":\"refused\"}");
                return new MockResponse().withWebSocketUpgrade(new WebSocketListener() {
                    @Override
                    public void onOpen(WebSocket ws, Response response) {
                        if (welcome) ws.send("{\"type\":\"Welcome\",\"request_id\":\"r1\"}");
                    }

                    @Override
                    public void onMessage(WebSocket ws, String text) {
                        frames.add(text);
                        arrivals.add(text);
                        JsonNode frame = Json.parse(text);
                        if ("Settings".equals(frame.path("type").asText())) {
                            pause(appliedDelayMs);
                            ws.send("{\"type\":\"SettingsApplied\"}");
                            afterApplied.accept(ws);
                        }
                        onFrame.accept(ws, frame);
                    }

                    @Override
                    public void onClosing(WebSocket ws, int code, String reason) {
                        clientCloseCode = code;
                        ws.close(1000, null);
                    }
                });
            }
        });
        server.start();
    }

    /** Parses like a strict server: a key twice in one object fails. */
    static final ObjectMapper STRICT = new ObjectMapper().enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION);

    /** A client frame, parsed with {@link #STRICT}; a repeated key fails the test. */
    static JsonNode strict(String frame) {
        try {
            return STRICT.readTree(frame);
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new AssertionError(e.getOriginalMessage() + " in " + frame, e);
        }
    }

    String url() {
        return "ws://" + server.getHostName() + ":" + server.getPort();
    }

    /** The types of the client's text frames, in order. */
    List<String> types() {
        List<String> out = new ArrayList<>();
        for (String f : frames) out.add(Json.parse(f).path("type").asText());
        return out;
    }

    /** Waits for the next client frame of this type, at most 5 s. */
    JsonNode await(String type) throws InterruptedException {
        long until = System.currentTimeMillis() + 5000;
        while (System.currentTimeMillis() < until) {
            String text = arrivals.poll(100, TimeUnit.MILLISECONDS);
            if (text != null && type.equals(Json.parse(text).path("type").asText())) return Json.parse(text);
        }
        throw new AssertionError("no " + type + " frame; got " + types());
    }

    static void pause(long ms) {
        if (ms <= 0) return;
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    /** Run options for a test: this server, a test key, no typed turns, output captured. */
    Common.RunOptions options(ByteArrayOutputStream out) {
        Common.RunOptions o = new Common.RunOptions();
        o.url = url();
        o.apiKey = "test-key-0123456789";
        o.interactive = false;
        o.out = new PrintStream(out, true, StandardCharsets.UTF_8);
        return o;
    }

    @Override
    public void close() {
        try {
            server.shutdown();
        } catch (IOException e) {
            // A socket the test left open: the server goes anyway.
        }
    }
}
