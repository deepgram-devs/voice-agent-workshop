// Mission 02, Read the room: notice a frustrated caller and change course once.
//
// Run it:    make run 02   (or, from java/: sh mission.sh run 02-read-the-room)
//            needs DEEPGRAM_API_KEY or your workshop token in .env; in Docker: docker compose run --rm workshop-java make run 02
//            Java runs on your machine, in GitHub Codespaces, in the dev container or in Docker's workshop-java service (a JDK 17+; README: Java)
// Check it:  make check 02     (offline, no key)
// Live:      make live 02      (real API: needs DEEPGRAM_API_KEY or your workshop token in .env; the timing feature too, see the README)
//
// Three TODOs below. The brief is in ../../../missions/02-read-the-room/README.md.
package m02_read_the_room;

import static agent.Json.obj;

import agent.Agent;
import agent.Common;
import agent.Event;
import agent.Mission;
import com.fasterxml.jackson.databind.node.ObjectNode;

public class Start implements Mission {
    static final String PROMPT = "You are a patient receptionist at a developer conference. "
            + "Keep replies to one or two short sentences. Never use markdown or emoji.";

    // TODO 1: Pick a frustration limit: how many annoyed turns before FrustrationDetected
    // says escalated. A whole number from 1 to 5.
    static final Integer FRUSTRATION_LIMIT = null;

    // TODO 2: UpdatePrompt adds to the prompt the agent already has. This sends the
    // whole prompt again, so the agent ends up with it twice. Keep only the new lines:
    // delete PROMPT and the + before the string, and the space that starts it.
    static final String RECOVERY = PROMPT
            + " The caller is frustrated. Say sorry once, stop asking questions, "
            + "and offer to have someone from registration call them back within the hour.";

    // One call, one recovery. Reset when a new call starts.
    boolean recovered = false;

    /** The Settings message: sent once, as soon as the server says Welcome. */
    @Override
    public ObjectNode buildSettings() {
        ObjectNode timing = obj("type", "deepgram", "version", "v1");
        if (FRUSTRATION_LIMIT != null) {
            timing.put("frustration_max_count", FRUSTRATION_LIMIT);
        }
        return obj(
                "audio", obj(
                        "input", obj("encoding", "linear16", "sample_rate", 16000),
                        "output", obj("encoding", "linear16", "sample_rate", 24000, "container", "none")),
                "agent", obj(
                        "listen", obj("provider", Common.listenProvider()),
                        "think", obj("provider", obj("type", "open_ai", "model", "gpt-4o-mini"), "prompt", PROMPT),
                        "speak", obj("provider", obj("type", "deepgram", "model", "flux-hannah-en", "version", "v2")),
                        // The timing block sits beside listen, think and speak.
                        "think_live", obj("provider", timing)));
    }

    /** Every event from the agent lands here, as the wire JSON. */
    @Override
    public void onEvent(Agent agent, Event event) {
        String kind = event.type();
        if ("Welcome".equals(kind)) {
            recovered = false; // a new call
        } else if ("FrustrationDetected".equals(kind)) {
            System.out.println("[frustration] count " + event.str("count") + ", escalated " + event.str("escalated"));
            // TODO 3: This sends the recovery on every frustration event, so the agent
            // apologizes again and again. Send it once: the first time `escalated` is
            // true (event.bool("escalated", false)). The `recovered` flag above is there to help.
            agent.updatePrompt(RECOVERY);
        }
    }

    public static void main(String[] args) {
        Common.run(new Start(), args);
    }
}
