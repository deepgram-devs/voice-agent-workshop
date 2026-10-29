package agent;

/** Your mission code threw (in buildSettings or onEvent). The cause is what it threw. */
public class MissionError extends RuntimeException {
    public MissionError(Throwable cause) {
        super(cause.toString(), cause);
    }
}
