package agent;

/**
 * `make run NN`: {@code java agent.Run m00_first_words Start [--no-save]}. Makes the mission
 * here rather than in its own main, so a static or field initializer that throws gets the
 * same "Can't load" line as `make check`, not the JVM's stack trace. Your mission's own
 * main ({@code Common.run(new Start(), args)}) does the same run from an IDE.
 */
public final class Run {
    private Run() {}

    public static void main(String[] args) {
        if (args.length < 2) {
            System.err.println("usage: java agent.Run <mission package> <Start|Solution> [--no-save]");
            System.exit(2);
        }
        String className = args[0] + "." + args[1];
        Mission mission;
        try {
            mission = (Mission) Class.forName(className).getDeclaredConstructor().newInstance();
        } catch (ReflectiveOperationException | ExceptionInInitializerError e) {
            Common.utf8Output();
            System.err.println(Testing.cantLoad(className, e));
            System.exit(1);
            return;
        }
        Common.run(mission, java.util.Arrays.copyOfRange(args, 2, args.length));
    }
}
