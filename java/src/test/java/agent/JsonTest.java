package agent;

import static agent.Json.arr;
import static agent.Json.obj;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class JsonTest {
    @Test
    void objAndArrKeepTheOrderAndTakeEveryValueKind() {
        String text = Json.write(obj(
                "b", 1, "a", "x", "c", true, "d", 0.5, "e", arr(1, "two", null), "f", List.of(3), "g", Map.of("k", "v"), "h", obj()));
        assertEquals("{\"b\":1,\"a\":\"x\",\"c\":true,\"d\":0.5,\"e\":[1,\"two\",null],\"f\":[3],\"g\":{\"k\":\"v\"},\"h\":{}}", text);
        assertEquals("obj(...) takes key, value pairs, but got 1 arguments. Give every key a value.",
                assertThrows(IllegalArgumentException.class, () -> obj("odd")).getMessage());
        assertEquals("obj(...) keys are strings, but argument 1 isn't. Start each pair with a string key, like \"model\".",
                assertThrows(IllegalArgumentException.class, () -> obj(1, "x")).getMessage());
    }

    @Test
    void withoutNullsDropsNullFieldsAtEveryDepthButKeepsListItems() {
        assertEquals(Json.parse("{\"a\":1,\"b\":{\"d\":[null,2]}}"),
                Json.withoutNulls(Json.parse("{\"a\":1,\"n\":null,\"b\":{\"c\":null,\"d\":[null,2]}}")));
    }

    @Test
    void sameJsonComparesNumbersByValue() {
        assertTrue(Json.sameJson(Json.parse("{\"speed\":1,\"x\":[1.0]}"), Json.parse("{\"speed\":1.0,\"x\":[1]}")));
        assertFalse(Json.sameJson(Json.parse("{\"speed\":1}"), Json.parse("{\"speed\":1.5}")));
        assertFalse(Json.sameJson(Json.parse("{\"a\":1}"), Json.parse("{\"a\":1,\"b\":null}")));
        assertFalse(Json.sameJson(Json.parse("{\"a\":\"1\"}"), Json.parse("{\"a\":1}")));
    }

    @Test
    void eventReadsTheWireJson() {
        Event e = Event.parse("{\"type\":\"FunctionCallRequest\",\"functions\":[{\"id\":\"f1\",\"name\":\"end_call\",\"client_side\":true},7],\"n\":2}");
        assertEquals("FunctionCallRequest", e.type());
        assertEquals(1, e.items("functions").size());
        assertEquals("f1", e.items("functions").get(0).str("id"));
        assertTrue(e.items("functions").get(0).bool("client_side", false));
        assertEquals(2.0, e.num("n"));
        assertEquals("2", e.str("n"));
        assertNull(e.str("missing"));
        assertTrue(e.items("missing").isEmpty());
        assertNull(Event.parse("not json"));
        assertNull(Event.parse("[1]"));
    }
}
