package agent;

/**
 * A problem the person can fix (no key, a bad URL, a refused connection). Printed as
 * one line, without a stack trace.
 *
 * <p>{@code retryable} is true when trying again later can help (the network dropped, or
 * the server was busy), and false when something has to change first (a refused key).
 */
public class SetupError extends Exception {
    public final boolean retryable;

    public SetupError(String message) {
        this(message, false);
    }

    public SetupError(String message, boolean retryable) {
        super(message);
        this.retryable = retryable;
    }
}
