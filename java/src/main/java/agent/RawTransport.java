package agent;

import com.deepgram.core.ReconnectingWebSocketListener.ReconnectOptions;
import com.deepgram.core.transport.DeepgramTransport;
import com.deepgram.core.transport.DeepgramTransportFactory;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BiConsumer;
import java.util.function.Consumer;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okio.ByteString;

/**
 * The agent socket under the SDK's client, on OkHttp, handed to the SDK through its public
 * {@code transportFactory}. The SDK still sends every typed message and parses every
 * event; this adds what deepgram-java-sdk 0.11.1 has no public call for:
 *
 * <ul>
 *   <li>{@link Transport#sendText} sends raw JSON (a field or value the SDK's types don't
 *       know), on the same queue as typed sends, so the order holds;
 *   <li>the HTTP status of a refused connection (401, 404, 429), which the SDK drops;
 *   <li>one end callback with the close code, 1006 when the network dropped (the SDK
 *       reports a drop as an error only).
 * </ul>
 *
 * Reconnects are off: the check harness takes one connection (a reconnecting run, as
 * Python's run_resilient, is Phase B).
 */
public final class RawTransport {
    private RawTransport() {}

    /** One connection attempt, no retries, and nothing to wait for on disconnect. */
    public static final ReconnectOptions NO_RECONNECTS = ReconnectOptions.builder()
            .maxRetries(0)
            .minReconnectionDelayMs(1)
            .maxReconnectionDelayMs(1)
            .build();

    /** WebSocket pings: an unanswered one ends the run (1006), as Python's 20 s ping does. */
    public static final long PING_MS = 20_000;

    public static final class Factory implements DeepgramTransportFactory {
        private final OkHttpClient http;
        private volatile Transport last;
        private volatile BiConsumer<Integer, String> onEnd = (code, reason) -> {};

        public Factory() {
            this(PING_MS);
        }

        public Factory(long pingMs) {
            http = new OkHttpClient.Builder()
                    .readTimeout(0, TimeUnit.MILLISECONDS)
                    .pingInterval(pingMs, TimeUnit.MILLISECONDS)
                    .build();
        }

        @Override
        public DeepgramTransport create(String url, Map<String, String> headers) {
            last = new Transport(http, url, headers, this);
            return last;
        }

        @Override
        public ReconnectOptions reconnectOptions() {
            return NO_RECONNECTS;
        }

        /** Called once per connection that opened: (close code, reason); 1006 for a drop. */
        public void onEnd(BiConsumer<Integer, String> listener) {
            onEnd = listener;
        }

        /** The connection this factory made last, or null. */
        public Transport last() {
            return last;
        }

        /** The HTTP status that refused the last connection, or null. */
        public Integer failureStatus() {
            Transport t = last;
            return t == null ? null : t.status;
        }

        /** Lets OkHttp's threads go, so the program can end. */
        public void shutdown() {
            http.dispatcher().executorService().shutdown();
            http.connectionPool().evictAll();
        }
    }

    public static final class Transport implements DeepgramTransport {
        // The SDK registers its five callbacks just after create() returns; the socket can
        // open first. Every OkHttp callback waits here (at most 2 s) so none is lost.
        private final CountDownLatch registered = new CountDownLatch(5);
        private final CountDownLatch ended = new CountDownLatch(1);
        private final AtomicBoolean endSent = new AtomicBoolean();
        private final Factory factory;
        private final WebSocket socket;
        private volatile Runnable onOpen;
        private volatile Consumer<String> onText;
        private volatile Consumer<byte[]> onBinary;
        private volatile Consumer<Throwable> onError;
        private volatile CloseListener onClose;
        private volatile boolean open;
        private volatile boolean opened;
        volatile Integer status;
        /** Tests only: runs in onClosing, after the transport stops counting as open. */
        static volatile Consumer<Transport> afterClosing;

        Transport(OkHttpClient http, String url, Map<String, String> headers, Factory factory) {
            this.factory = factory;
            Request.Builder request = new Request.Builder().url(url);
            headers.forEach(request::header);
            socket = http.newWebSocket(request.build(), new WebSocketListener() {
                @Override
                public void onOpen(WebSocket ws, Response response) {
                    awaitRegistered();
                    open = true;
                    opened = true;
                    Runnable c = onOpen;
                    if (c != null) c.run();
                }

                @Override
                public void onMessage(WebSocket ws, String text) {
                    awaitRegistered();
                    Consumer<String> c = onText;
                    if (c != null) c.accept(text);
                }

                @Override
                public void onMessage(WebSocket ws, ByteString bytes) {
                    awaitRegistered();
                    Consumer<byte[]> c = onBinary;
                    if (c != null) c.accept(bytes.toByteArray());
                }

                @Override
                public void onClosing(WebSocket ws, int code, String reason) {
                    open = false; // closing: a send now has nowhere to go, and isn't an error
                    Consumer<Transport> hook = afterClosing;
                    if (hook != null) hook.accept(Transport.this);
                    // Answer the server's close frame (1005, "no status", isn't sendable).
                    ws.close(code == 1005 ? 1000 : code, null);
                }

                @Override
                public void onClosed(WebSocket ws, int code, String reason) {
                    open = false;
                    awaitRegistered();
                    CloseListener c = onClose;
                    if (c != null) c.onClose(code, reason);
                    end(code, reason == null ? "" : reason);
                }

                @Override
                public void onFailure(WebSocket ws, Throwable t, Response response) {
                    boolean wasOpen = opened;
                    open = false;
                    if (response != null) {
                        status = response.code();
                        response.close();
                    }
                    awaitRegistered();
                    Consumer<Throwable> c = onError;
                    if (c != null) c.accept(t);
                    if (wasOpen) end(1006, "no close frame");
                    else ended.countDown();
                }
            });
        }

        private void end(int code, String reason) {
            if (endSent.compareAndSet(false, true)) {
                factory.onEnd.accept(code, reason);
            }
            ended.countDown();
        }

        private void awaitRegistered() {
            try {
                registered.await(2, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }

        /**
         * Waits for the connection to end (close frame answered, or dropped), at most
         * {@code ms}.
         */
        public boolean awaitEnd(long ms) throws InterruptedException {
            return ended.await(ms, TimeUnit.MILLISECONDS);
        }

        /** Sends JSON text as is. The raw path: a message the SDK's types can't carry. */
        @Override
        public CompletableFuture<Void> sendText(String data) {
            if (!socket.send(data)) {
                return CompletableFuture.failedFuture(new IllegalStateException("the connection is closed"));
            }
            return CompletableFuture.completedFuture(null);
        }

        @Override
        public CompletableFuture<Void> sendBinary(byte[] data) {
            if (!socket.send(ByteString.of(data))) {
                return CompletableFuture.failedFuture(new IllegalStateException("the connection is closed"));
            }
            return CompletableFuture.completedFuture(null);
        }

        @Override
        public void onTextMessage(Consumer<String> listener) {
            onText = listener;
            registered.countDown();
        }

        @Override
        public void onBinaryMessage(Consumer<byte[]> listener) {
            onBinary = listener;
            registered.countDown();
        }

        @Override
        public void onOpen(Runnable listener) {
            onOpen = listener;
            registered.countDown();
        }

        @Override
        public void onError(Consumer<Throwable> listener) {
            onError = listener;
            registered.countDown();
        }

        @Override
        public void onClose(CloseListener listener) {
            onClose = listener;
            registered.countDown();
        }

        @Override
        public boolean isOpen() {
            return open;
        }

        @Override
        public void close() {
            socket.close(1000, null);
        }
    }
}
