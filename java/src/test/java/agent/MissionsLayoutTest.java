package agent;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;

/** Every Java mission is the same exercise as the Python one, on the helpers only. */
class MissionsLayoutTest {
    static final Path JAVA = Common.PROJECT_ROOT.resolve("java").resolve("missions");
    static final Pattern TODO = Pattern.compile("(#|//)\\s*TODO (\\d+)\\b");

    static List<Path> missions() throws IOException {
        try (Stream<Path> dirs = Files.list(JAVA)) {
            return dirs.filter(Files::isDirectory).sorted().toList();
        }
    }

    static Set<String> todos(Path file) throws IOException {
        Set<String> numbers = new TreeSet<>();
        Matcher m = TODO.matcher(Files.readString(file));
        while (m.find()) numbers.add(m.group(2));
        return numbers;
    }

    @Test
    void eachMissionHasAStartAndASolutionForAMissionWithChecks() throws IOException {
        assertFalse(missions().isEmpty());
        for (Path dir : missions()) {
            String folder = Testing.missionName(dir.getFileName().toString());
            assertTrue(Files.exists(Common.PROJECT_ROOT.resolve("missions").resolve(folder).resolve("check.mjs")), folder);
            assertTrue(Files.exists(dir.resolve("Start.java")), dir + "/Start.java");
            assertTrue(Files.exists(dir.resolve("Solution.java")), dir + "/Solution.java");
        }
    }

    @Test
    void everyMissionWithChecksHasAJavaPackage() throws IOException {
        Path checked = Common.PROJECT_ROOT.resolve("missions");
        List<String> missing = new ArrayList<>();
        try (Stream<Path> dirs = Files.list(checked)) {
            for (Path dir : dirs.filter(d -> Files.exists(d.resolve("check.mjs"))).sorted().toList()) {
                String folder = dir.getFileName().toString();
                String pkg = "m" + folder.replace('-', '_');
                if (!Files.exists(JAVA.resolve(pkg).resolve("Start.java"))) {
                    missing.add(folder + " (java/missions/" + pkg + ")");
                }
            }
        }
        assertTrue(missing.isEmpty(), "missions with checks and no Java Start.java: " + missing);
    }

    @Test
    void missionsUseTheHelpersOnlyNeverTheSdk() throws IOException {
        try (Stream<Path> files = Files.walk(JAVA)) {
            for (Path f : files.filter(p -> p.toString().endsWith(".java")).toList()) {
                assertFalse(Files.readString(f).contains("com.deepgram"), f + " imports the SDK: use agent.*");
            }
        }
    }

    @Test
    void startFilesHaveThePythonStartFilesTodoNumbers() throws IOException {
        for (Path dir : missions()) {
            String folder = Testing.missionName(dir.getFileName().toString());
            Path python = Common.PROJECT_ROOT.resolve("python").resolve("missions").resolve(folder).resolve("start.py");
            assertEquals(todos(python), todos(dir.resolve("Start.java")), folder);
            assertTrue(todos(dir.resolve("Solution.java")).isEmpty(), folder + " Solution.java has a TODO");
        }
    }
}
