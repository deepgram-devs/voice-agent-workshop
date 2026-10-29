// Mission 01, Let me finish: an agent that waits while you talk,
// and hangs up when you say goodbye.
//
// Run it:    make run 01 MISSION_TARGET=solution
// Check it:  make check 01 MISSION_TARGET=solution     (offline, no key)
// Live:      make live 01 MISSION_TARGET=solution      (real API; needs the timing
//                                                       feature, see the README)
//
// Reference solution. Try Start.java first.
package m01_let_me_finish;

import static agent.Json.arr;
import static agent.Json.obj;

import agent.Agent;
import agent.Common;
import agent.Event;
import agent.Mission;
import com.fasterxml.jackson.databind.node.ObjectNode;

public class Solution implements Mission {
    static final String PROMPT = "You are a patient receptionist taking down a caller's phone number. "
            + "Keep replies to one short sentence. When the caller says goodbye or has "
            + "nothing else to add, call end_call straight away, before you say anything.";
    static final String VOICE = "flux-hannah-en";
    static final String GREETING = "Hi, you've reached the front desk. Would you like to leave a number?";

    // The timing knobs. Real wire names; the feature key is `timing`.
    static final double BACKCHANNEL = 0.3; // 0 to 1: how readily it says "mm-hm" instead of taking the turn
    static final int PRESENCE_INTERVAL_MS = 4000; // silence before it asks whether you're still there
    static final int PRESENCE_MAX = 2; // how many times it asks. It never hangs up by itself.

    // Hearing: the speech-to-text model (LISTEN_MODEL in .env picks another).
    static final ObjectNode LISTEN = Common.listenProvider();

    // Declared in Settings, so the agent can ask your code to end the call.
    static final ObjectNode END_CALL = obj(
            "name", "end_call",
            "description", "End the phone call. Call this once the caller has said goodbye and "
                    + "has nothing else to add.",
            "parameters", obj("type", "object", "properties", obj()));

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
        // The timing block.
        agent.set("think_live", obj(
                "provider", obj(
                        "type", "deepgram",
                        "version", "v1",
                        "agent_backchannel_sensitivity", BACKCHANNEL,
                        "presence_check_interval_ms", PRESENCE_INTERVAL_MS,
                        "presence_check_max_count", PRESENCE_MAX)));
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
                    agent.functionCallResponse(fn.str("id"), "end_call", "The call is ending. Say a short goodbye.");
                    hangUpPending = true;
                }
            }

        } else if ("AgentAudioDone".equals(kind) && hangUpPending) {
            // The goodbye has finished playing: now hang up.
            System.out.println("[hang up] the agent said goodbye");
            agent.close();
        }
    }

    public static void main(String[] args) {
        Common.run(new Solution(), args);
    }
}
