// Mission 01, Let me finish: an agent that waits while you talk,
// and hangs up when you say goodbye.
//
// Run it:    make run 01   (or, from java/: sh mission.sh run 01-let-me-finish)
//            needs DEEPGRAM_API_KEY or your workshop token in .env; in Docker: docker compose run --rm workshop-java make run 01
//            Java runs on your machine, in GitHub Codespaces, in the dev container or in Docker's workshop-java service (a JDK 17+; README: Java)
// Check it:  make check 01     (offline, no key)
// Live:      make live 01      (real API: needs DEEPGRAM_API_KEY or your workshop token in .env; the timing feature too, see the README)
//
// Four TODOs below. The brief is in ../../../missions/01-let-me-finish/README.md.
package m01_let_me_finish;

import static agent.Json.arr;
import static agent.Json.obj;

import agent.Agent;
import agent.Common;
import agent.Event;
import agent.Mission;
import com.fasterxml.jackson.databind.node.ObjectNode;

public class Start implements Mission {
    static final String PROMPT = "You are a patient receptionist taking down a caller's phone number. "
            + "Keep replies to one short sentence. When the caller says goodbye or has "
            + "nothing else to add, call end_call straight away, before you say anything.";
    static final String VOICE = "flux-hannah-en";
    static final String GREETING = "Hi, you've reached the front desk. Would you like to leave a number?";

    // The timing knobs, under their wire names (the fields as the API spells them); the feature key is `timing`.
    static final double BACKCHANNEL = 0.3; // 0 to 1: how readily it says "mm-hm" instead of taking the turn
    static final int PRESENCE_INTERVAL_MS = 4000; // silence before it asks whether you're still there
    static final int PRESENCE_MAX = 2; // how many times it asks. It never hangs up by itself.

    // Hearing: the speech-to-text model (LISTEN_MODEL in .env picks another).
    static final ObjectNode LISTEN = Common.listenProvider();

    // TODO 2 (TODO 1 is below, in buildSettings()): end_call is the function the agent calls to
    // ask your code to end the call. Its "name" and "parameters" are written; fill in the
    // "description": write one sentence: when should the model call it?
    static final ObjectNode END_CALL = obj(
            "name", "end_call",
            "description", "",
            "parameters", obj("type", "object", "properties", obj())); // a JSON Schema: this function takes no arguments

    // One call's state. A new call starts at Welcome.
    boolean hangUpPending = false;

    /** The Settings message: sent once, as soon as the server says Welcome. */
    @Override
    public ObjectNode buildSettings() {
        ObjectNode think = obj(
                "provider", obj("type", "open_ai", "model", "gpt-4o-mini"),
                "prompt", PROMPT,
                "functions", arr(END_CALL));
        ObjectNode agent = obj(
                "listen", obj("provider", LISTEN),
                "think", think,
                "speak", obj("provider", obj("type", "deepgram", "model", VOICE, "version", "v2")),
                "greeting", GREETING);
        // TODO 1: Turn on timing: add the block below to agent by uncommenting it (agent is a Jackson
        // ObjectNode: set adds a nested object, put a string or a number).
        // agent.set("think_live", obj(
        //         "provider", obj(
        //                 "type", "deepgram",
        //                 "version", "v1",
        //                 "agent_backchannel_sensitivity", BACKCHANNEL,
        //                 "presence_check_interval_ms", PRESENCE_INTERVAL_MS,
        //                 "presence_check_max_count", PRESENCE_MAX)));
        return obj(
                "audio", obj(
                        "input", obj("encoding", "linear16", "sample_rate", 16000),
                        "output", obj("encoding", "linear16", "sample_rate", 24000, "container", "none")),
                "agent", agent);
    }

    /** Every event from the agent lands here. */
    @Override
    public void onEvent(Agent agent, Event event) {
        String kind = event.type();
        if ("Welcome".equals(kind)) {
            hangUpPending = false;

        } else if ("FunctionCallRequest".equals(kind)) {
            for (Event fn : event.items("functions")) {
                if ("end_call".equals(fn.str("name"))) {
                    // TODO 3: Answer it, then remember that a hang-up is pending. Each fn has an "id".
                    // agent.functionCallResponse(fn.str("id"), "end_call", "<any short text>");
                    // hangUpPending = true;
                }
            }
        }

        // TODO 4: The agent says goodbye after your answer, and never hangs up on
        // its own. When an AgentAudioDone arrives and a hang-up is pending, the
        // goodbye has finished playing: print why the run ended, then close.
        // if ("AgentAudioDone".equals(kind) && hangUpPending) {
        //     System.out.println("[hang up] the agent said goodbye");
        //     agent.close();
        // }
    }

    public static void main(String[] args) {
        Common.run(new Start(), args);
    }
}
