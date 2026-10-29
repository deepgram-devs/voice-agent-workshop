package agent;

/**
 * Prints a non-ASCII line, after Common.utf8Output() unless the argument is "plain". OutputTest
 * runs it.
 */
public final class Utf8Probe {
    public static void main(String[] args) {
        if (args.length == 0 || !args[0].equals("plain")) Common.utf8Output();
        System.out.println("\u00bfQu\u00e9 tal? \u2014 s\u00ed");
    }
}
