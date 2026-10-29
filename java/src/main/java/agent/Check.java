package agent;

import java.util.List;

/**
 * The checks of one mission, for `make check NN` and `make live NN`:
 *
 * <pre>
 *   java agent.Check m00_first_words           every replay scenario, offline
 *   java agent.Check m00_first_words --live    the live check, on your key
 * </pre>
 *
 * It prints the report of each scenario that fails (each line PASS or FAIL, by TODO),
 * then a count, and exits 0 when all pass, else 1. MISSION_TARGET=solution checks the
 * reference solution.
 */
public final class Check {
    private Check() {}

    public static void main(String[] args) {
        Common.utf8Output();
        System.exit(run(args));
    }

    static int run(String[] args) {
        if (args.length < 1 || args.length > 2 || (args.length == 2 && !args[1].equals("--live"))) {
            System.out.println("usage: java agent.Check <mission package, e.g. m00_first_words> [--live]");
            return 2;
        }
        String pkg = args[0];
        boolean live = args.length == 2;
        int passed = 0;
        int failed = 0;
        try {
            List<String> scenarios = live ? List.of("live") : Testing.replayScenarios(Testing.missionName(pkg));
            for (String scenario : scenarios) {
                Mission mission = Testing.loadTarget(pkg); // a fresh one per run, as a new program would be
                Testing.Verdict verdict = live
                        ? Testing.checkLive(pkg, mission)
                        : Testing.checkReplay(pkg, mission, scenario);
                if (verdict.passed()) {
                    passed++;
                } else {
                    failed++;
                    System.out.println();
                    System.out.println((live ? "live" : "replay: " + scenario) + " did not pass:");
                    System.out.println(verdict.report());
                }
            }
        } catch (IllegalStateException e) {
            // Node.js or the harness is missing: its own line says what to do.
            System.out.println(e.getMessage());
            return 1;
        } catch (ReflectiveOperationException | ExceptionInInitializerError e) {
            System.out.println(Testing.cantLoad(pkg + "." + Testing.target(), e));
            return 1;
        } catch (Exception e) {
            System.out.println(Redact.describeError(e));
            return 1;
        }
        System.out.println();
        System.out.println(failed > 0 ? failed + " failed, " + passed + " passed" : passed + " passed");
        return failed > 0 ? 1 : 0;
    }
}
