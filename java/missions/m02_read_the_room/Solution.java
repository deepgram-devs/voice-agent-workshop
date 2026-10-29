// Mission 02, Read the room: notice a frustrated caller and change course once.
//
// Run it:    make run 02 MISSION_TARGET=solution
// Check it:  make check 02 MISSION_TARGET=solution     (offline, no key)
// Live:      make live 02 MISSION_TARGET=solution      (real API; needs the `timing`
//                                                       feature, see the README)
//
// Reference solution. Try Start.java first.
package m02_read_the_room;

import static agent.Json.obj;

import agent.Agent;
import agent.Common;
import agent.Event;
import agent.Mission;
import com.fasterxml.jackson.databind.node.ObjectNode;

public class Solution implements Mission {
    static final String PROMPT = "You are a patient receptionist at a developer conference. "
            + "Keep replies to one or two short sentences. Never use markdown or emoji.";

    // How many annoyed turns before FrustrationDetected says escalated.
    static final Integer FRUSTRATION_LIMIT = 2;

    // What the agent does once the caller has had enough. UpdatePrompt adds this to
    // the prompt the agent already has, so it holds only the new lines.
    static final String RECOVERY = "The caller is frustrated. Say sorry once, stop asking questions, "
            + "and offer to have someone from registration call them back within the hour.";

    // One call, one recovery. Reset when a new call starts.
    boolean recovered = false;

    /** The Settings message: sent once, as soon as the server says Welcome. */
    @Override
    public ObjectNode buildSettings() {
        return obj(
                "audio", obj(
                        "input", obj("encoding", "linear16", "sample_rate", 16000),
                        "output", obj("encoding", "linear16", "sample_rate", 24000, "container", "none")),
                "agent", obj(
                        "listen", obj("provider", Common.listenProvider()),
                        "think", obj("provider", obj("type", "open_ai", "model", "gpt-4o-mini"), "prompt", PROMPT),
                        "speak", obj("provider", obj("type", "deepgram", "model", "flux-hannah-en", "version", "v2")),
                        // The timing block sits beside listen, think and speak.
                        "think_live", obj(
                                "provider", obj(
                                        "type", "deepgram",
                                        "version", "v1",
                                        "frustration_max_count", FRUSTRATION_LIMIT))));
    }

    /** Every event from the agent lands here, as the wire JSON. */
    @Override
    public void onEvent(Agent agent, Event event) {
        String kind = event.type();
        if ("Welcome".equals(kind)) {
            recovered = false; // a new call
        } else if ("FrustrationDetected".equals(kind)) {
            System.out.println("[frustration] count " + event.str("count") + ", escalated " + event.str("escalated"));
            if (event.bool("escalated", false) && !recovered) {
                recovered = true;
                agent.updatePrompt(RECOVERY);
            }
        }
    }

    public static void main(String[] args) {
        Common.run(new Solution(), args);
    }
}
