package agent;

import java.io.BufferedReader;
import java.io.Console;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.BlockingQueue;

/**
 * Reads typed turns on one background thread for the whole program and hands each line
 * to the conversation running now. The end of the input arrives as {@link #END}.
 */
public final class TypedLines {
    /** Put on the queue when the input ends (Ctrl-D, or the last piped line). Compare with ==. */
    public static final String END = new String("<end of input>");

    private static TypedLines stdin;

    private final InputStream input;
    private volatile BlockingQueue<String> target;
    private boolean started;

    public TypedLines(InputStream input) {
        this.input = input;
    }

    /** The one reader of System.in. */
    public static synchronized TypedLines stdin() {
        if (stdin == null) stdin = new TypedLines(System.in);
        return stdin;
    }

    public synchronized void attach(BlockingQueue<String> queue) {
        target = queue;
        if (!started) {
            started = true;
            Thread reader = new Thread(this::read, "typed-lines");
            reader.setDaemon(true);
            reader.start();
        }
    }

    public void detach() {
        target = null;
    }

    private void send(String line) {
        BlockingQueue<String> queue = target;
        if (queue != null) queue.offer(line);
    }

    private void read() {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (!line.isBlank()) send(line.strip());
            }
        } catch (IOException e) {
            // The input went away: that ends it, as Ctrl-D does.
        }
        send(END);
    }

    /**
     * Where typed turns come from: "tty" (you type them) or "piped"
     * ({@code echo hi | make run 00}, or a file). Piped lines go one at a time, each after the
     * reply to the one before.
     */
    public static String inputMode() {
        // mission.sh says what stdin is (-Dworkshop.stdin=tty or piped), as Python decides it.
        String said = System.getProperty("workshop.stdin", "");
        if (said.equals("tty") || said.equals("piped")) return said;
        Console console = System.console();
        if (console == null) return "piped";
        try {
            // JDK 22 and newer return a console even when stdin is a pipe; isTerminal() tells.
            Method isTerminal = Console.class.getMethod("isTerminal");
            return Boolean.TRUE.equals(isTerminal.invoke(console)) ? "tty" : "piped";
        } catch (ReflectiveOperationException e) {
            return "tty";
        }
    }
}
