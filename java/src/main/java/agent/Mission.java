package agent;

import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * A mission program: the Settings it sends, and what it does with each event.
 * {@code Common.run(new Start(), args)} connects and calls these.
 */
public interface Mission {
    /** The Settings message: sent once, as soon as the server says Welcome. */
    ObjectNode buildSettings();

    /** Every event from the agent lands here, on one thread, in order. */
    default void onEvent(Agent agent, Event event) throws Exception {}
}
