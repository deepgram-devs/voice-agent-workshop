package agent;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.io.TempDir;

/** java/mission.sh's own lines, for the cases make doesn't catch first. */
@Timeout(value = 60, threadMode = Timeout.ThreadMode.SEPARATE_THREAD)
class MissionShTest {
    /** Runs sh mission.sh with {@code args} and the given variables; {exit code, output}. */
    static String[] missionSh(Map<String, String> vars, String... args) throws Exception {
        String[] cmd = new String[args.length + 2];
        cmd[0] = "/bin/sh";
        cmd[1] = "mission.sh";
        System.arraycopy(args, 0, cmd, 2, args.length);
        ProcessBuilder pb = new ProcessBuilder(cmd).directory(Common.PROJECT_ROOT.resolve("java").toFile()).redirectErrorStream(true);
        // JAVA_SDK_VERSION too: CI's latest-SDK job exports it, the stamps here say sdk=pinned, and a
        // stale stamp makes setup and check build (sh ./mvnw) on a PATH these tests keep to a few tools.
        pb.environment().keySet().removeIf(n -> n.startsWith("DEEPGRAM_") || n.startsWith("WORKSHOP_")
                || n.equals("CODESPACES") || n.equals("DEVCONTAINER") || n.equals("JAVA_SDK_VERSION"));
        pb.environment().putAll(vars);
        Process p = pb.start();
        String out = ExamplesTest.output(p, 30);
        return new String[] {String.valueOf(p.exitValue()), out.strip()};
    }

    @Test
    void aBadMissionTargetSaysWhatItTakes() throws Exception {
        String line = "MISSION_TARGET must be start or solution: leave it unset, or add MISSION_TARGET=solution.";
        for (String cmd : new String[] {"check", "run"}) {
            String[] r = missionSh(Map.of("MISSION_TARGET", "foo"), cmd, "00-first-words");
            assertEquals("2", r[0], r[1]);
            assertEquals(line, r[1]);
        }
    }

    static final String JDK_SITE = "https://adoptium.net";
    // The Makefile's JDK_APT, word for word.
    static final String JDK_APT = "sudo apt-get update && sudo apt-get install -y openjdk-21-jdk-headless";

    /** A PATH holding only the tools mission.sh uses before javac, and a javac when given. */
    static String toolsOnly(Path dir, String javacVersion) throws IOException {
        for (String tool : new String[] {"dirname", "uname", "sed", "head", "grep", "cat", "find", "tr", "rm", "mkdir"}) {
            for (String d : System.getenv("PATH").split(File.pathSeparator)) {
                Path found = Paths.get(d, tool);
                if (Files.isExecutable(found)) {
                    Files.createSymbolicLink(dir.resolve(tool), found);
                    break;
                }
            }
        }
        if (javacVersion != null) {
            Path javac = dir.resolve("javac");
            Files.writeString(javac, "#!/bin/sh\necho 'javac " + javacVersion + "'\n");
            javac.toFile().setExecutable(true);
        }
        return dir.toString();
    }

    @Test
    void theNeedsAJdkLinesGiveAptInAContainerAndTheLinkElsewhere(@TempDir Path tmp) throws Exception {
        Path none = Files.createDirectory(tmp.resolve("none"));
        Path old = Files.createDirectory(tmp.resolve("old"));
        String noJavac = toolsOnly(none, null);
        String oldJavac = toolsOnly(old, "11.0.2");
        Map<String, String> where = new java.util.LinkedHashMap<>();
        where.put("", JDK_SITE);
        where.put("CODESPACES", JDK_APT);
        where.put("DEVCONTAINER", JDK_APT);
        for (Map.Entry<String, String> e : where.entrySet()) {
            Map<String, String> vars = new HashMap<>();
            if (!e.getKey().isEmpty()) vars.put(e.getKey(), "true");
            vars.put("PATH", noJavac);
            String[] r = missionSh(vars, "setup");
            assertEquals("2", r[0], r[1]);
            // No java at all on the PATH: nothing about a runtime.
            assertEquals("No javac on the PATH. Java needs a JDK 17 or newer (" + e.getValue() + "), which includes javac. "
                    + "Install a JDK, then run make setup.", r[1]);
            vars.put("PATH", oldJavac);
            r = missionSh(vars, "setup");
            assertEquals("2", r[0], r[1]);
            assertEquals("Java needs a JDK 17 or newer (" + e.getValue() + "); you have javac 11.0.2. "
                    + "Install a newer JDK, then run make setup.", r[1]);
        }
    }

    @Test
    void aRuntimeWithoutJavacSaysSoAndTheComposeContainerSaysWhereJavaRuns(@TempDir Path tmp) throws Exception {
        // A `java` on the PATH and no javac: a JRE. The line says so, then what a JDK adds.
        Path jre = Files.createDirectory(tmp.resolve("jre"));
        String path = toolsOnly(jre, null);
        Path java = jre.resolve("java");
        Files.writeString(java, "#!/bin/sh\necho 'openjdk version \"17.0.2\"' >&2\n");
        java.toFile().setExecutable(true);
        Map<String, String> vars = new HashMap<>();
        vars.put("PATH", path);
        String[] r = missionSh(vars, "check", "00-first-words");
        assertEquals("2", r[0], r[1]);
        assertEquals("No javac on the PATH. The Java here is a runtime only. Java needs a JDK 17 or newer ("
                + JDK_SITE + "), which includes javac. Install a JDK, then run make setup.", r[1]);
        // The plain compose container (WORKSHOP_IN_DOCKER, compose.yaml's workshop service): no JDK in the image, so
        // name the workshop-java service, word for word as the Makefile's MSG_JAVA_DOCKER does.
        Path none = Files.createDirectory(tmp.resolve("none"));
        vars.put("PATH", toolsOnly(none, null));
        vars.put("WORKSHOP_IN_DOCKER", "1");
        for (String[] cmd : new String[][] {{"setup"}, {"check", "00-first-words"}, {"run", "00-first-words"}, {"example"}}) {
            r = missionSh(vars, cmd);
            assertEquals("2", r[0], r[1]);
            assertEquals("The Docker image has no JDK. For Java in Docker, use the workshop-java service (docker compose run "
                    + "--rm workshop-java make use java, then make setup); or VS Code Dev Containers, GitHub Codespaces, or "
                    + "your own machine (README: Java).", r[1]);
        }
    }

    @Test
    void aMissingSdkJarMakesSetupFetchAgain(@TempDir Path tmp) throws Exception {
        // java/target/ outlives the home volume (docker compose down -v): classpath.txt and the stamp say
        // "built" while the jars they name are gone. setup must fetch again, and say so with the first-time line.
        Path target = Files.createDirectory(tmp.resolve("target"));
        Path jar = tmp.resolve("gone/jackson-databind.jar");
        Files.writeString(target.resolve("classpath.txt"), jar + "\n");
        Files.writeString(target.resolve("helpers.stamp"), "sdk=pinned\n");
        Map<String, String> vars = new HashMap<>();
        vars.put("PATH", toolsOnly(Files.createDirectory(tmp.resolve("tools")), "17.0.2")); // need_jdk passes on the stub
        vars.put("JAVA_TARGET", target.toString());
        String[] r = missionSh(vars, "setup");
        // The first line is the verdict under test. What follows is mvnw's: on this PATH (no sh, no mvn) it is
        // "Building the Java helpers failed", on a fuller one a real build into the temp target; assert neither.
        assertEquals("[setup] Building the Java helpers and fetching the SDK: about a minute, the first time.", r[1].split("\n")[0]);
        // With a jar at the named path (or the real classpath a successful build wrote) and nothing newer than the
        // stamp, the helpers read as built.
        Files.createDirectories(jar.getParent());
        Files.writeString(jar, "");
        r = missionSh(vars, "setup");
        assertEquals("0", r[0], r[1]);
        assertEquals("[setup] The Java helpers are built.", r[1]);
    }

    @Test
    void aCompileErrorNamesTheFileFromTheRootAndTheCommandToRunAgain(@TempDir Path tmp) throws Exception {
        Path target = Files.createDirectory(tmp.resolve("target"));
        Path jar = tmp.resolve("lib/jackson-databind.jar");
        Files.createDirectories(jar.getParent());
        Files.writeString(jar, "");
        Files.writeString(target.resolve("classpath.txt"), jar + "\n");
        Files.writeString(target.resolve("helpers.stamp"), "sdk=pinned\n");
        // A javac that passes need_jdk and fails every compile with one javac-shaped line.
        Path tools = Files.createDirectory(tmp.resolve("tools"));
        String path = toolsOnly(tools, null);
        Path javac = tools.resolve("javac");
        Files.writeString(javac, "#!/bin/sh\ncase \"$1\" in -version) echo 'javac 17.0.2';; "
                + "*) printf 'missions/m00_first_words/Start.java:32: error: x\\n' >&2; exit 1;; esac\n");
        javac.toFile().setExecutable(true);
        Map<String, String> vars = new HashMap<>();
        vars.put("PATH", path);
        vars.put("JAVA_TARGET", target.toString());
        String tail = ", then run make check 00 SDK=java again.";
        String[] r = missionSh(vars, "check", "00-first-words");
        assertEquals("1", r[0], r[1]);
        String[] lines = r[1].split("\n");
        // javac's line, with the path from the project root; then the verdict line.
        assertEquals("java/missions/m00_first_words/Start.java:32: error: x", lines[0]);
        assertEquals("Your Java file doesn't compile: fix the first error above (java/missions/m00_first_words/Start.java:32)" + tail, lines[lines.length - 1]);
        // WORKSHOP_HINT_SDK empty (make passes it so when Java is the saved language): no SDK= on the command.
        vars.put("WORKSHOP_HINT_SDK", "");
        r = missionSh(vars, "check", "00-first-words");
        assertEquals("Your Java file doesn't compile: fix the first error above (java/missions/m00_first_words/Start.java:32), then run make check 00 again.", r[1].split("\n")[1]);
        // In Docker (compose.yaml's workshop-java service) the command carries the compose prefix.
        vars.put("WORKSHOP_IN_DOCKER", "1");
        vars.put("WORKSHOP_DOCKER_SERVICE", "workshop-java");
        r = missionSh(vars, "check", "00-first-words");
        assertEquals("Your Java file doesn't compile: fix the first error above (java/missions/m00_first_words/Start.java:32), then run docker compose run --rm workshop-java make check 00 again.", r[1].split("\n")[1]);
        // MISSION_TARGET rides along, after SDK=.
        vars.remove("WORKSHOP_IN_DOCKER");
        vars.remove("WORKSHOP_DOCKER_SERVICE");
        vars.remove("WORKSHOP_HINT_SDK");
        vars.put("MISSION_TARGET", "solution");
        r = missionSh(vars, "check", "00-first-words");
        assertEquals("Your Java file doesn't compile: fix the first error above (java/missions/m00_first_words/Start.java:32), then run make check 00 SDK=java MISSION_TARGET=solution again.", r[1].split("\n")[1]);
    }
}
