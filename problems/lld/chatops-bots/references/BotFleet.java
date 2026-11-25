import java.util.*;

public class BotFleet {
  private static final String REFUSAL = "refused";

  // One thing a bot can do. A bot is the abilities it holds, never a subclass per mix.
  private interface Ability {
    boolean takesArgument();

    String answer(String bot, String argument);
  }

  private record Acts(String done) implements Ability {
    public boolean takesArgument() {
      return true;
    }

    public String answer(String bot, String argument) {
      return done + " " + argument;
    }
  }

  private record Status() implements Ability {
    public boolean takesArgument() {
      return false;
    }

    public String answer(String bot, String argument) {
      return bot + " ok";
    }
  }

  // Wraps any ability and logs each command it answers; the answer is unchanged.
  private record Audited(String verb, Ability inner, List<String> log) implements Ability {
    public boolean takesArgument() {
      return inner.takesArgument();
    }

    public String answer(String bot, String argument) {
      String reply = inner.answer(bot, argument);
      String command = takesArgument() ? verb + " " + argument : verb;
      log.add(command + " -> " + reply);
      return reply;
    }
  }

  private static final Map<String, Ability> KNOWN =
      Map.of(
          "deploy", new Acts("deployed"),
          "page", new Acts("paged"),
          "query", new Acts("queried"),
          "status", new Status());

  private static Ability ability(String name) {
    Ability found = KNOWN.get(name);
    if (found == null) throw new IllegalArgumentException("unknown ability");
    return found;
  }

  private static final class Bot {
    final TreeMap<String, Ability> held = new TreeMap<>();
    List<String> log = null;

    void equip(String name) {
      Ability base = ability(name);
      held.put(name, log == null ? base : new Audited(name, base, log));
    }
  }

  private final Map<String, Bot> bots = new HashMap<>();

  public BotFleet() {}

  private Bot bot(String bot) {
    Bot found = bots.get(bot);
    if (found == null) throw new IllegalArgumentException("unknown bot");
    return found;
  }

  public void create(String bot, List<String> abilities) {
    if (bot.isEmpty() || bots.containsKey(bot))
      throw new IllegalArgumentException("a bot needs a new, non-empty name");
    for (String name : abilities) ability(name);
    if (new HashSet<>(abilities).size() != abilities.size())
      throw new IllegalArgumentException("an ability is listed twice");
    Bot made = new Bot();
    for (String name : abilities) made.equip(name);
    bots.put(bot, made);
  }

  public boolean grant(String bot, String name) {
    Bot found = bot(bot);
    ability(name);
    if (found.held.containsKey(name)) return false;
    found.equip(name);
    return true;
  }

  public boolean revoke(String bot, String name) {
    Bot found = bot(bot);
    ability(name);
    return found.held.remove(name) != null;
  }

  public String handle(String bot, String command) {
    Bot found = bot(bot);
    int space = command.indexOf(' ');
    String verb = space < 0 ? command : command.substring(0, space);
    String argument = space < 0 ? "" : command.substring(space + 1);
    Ability shape = ability(verb);
    boolean fits = shape.takesArgument() ? !argument.isEmpty() : space < 0;
    if (!fits) throw new IllegalArgumentException("the command doesn't fit its ability");
    Ability held = found.held.get(verb);
    return held == null ? REFUSAL : held.answer(bot, argument);
  }

  public List<String> abilities(String bot) {
    return new ArrayList<>(bot(bot).held.keySet());
  }

  // The extension round: auditing wraps each ability the bot holds, now and later.
  public void audit(String bot) {
    Bot found = bot(bot);
    if (found.log != null) return;
    found.log = new ArrayList<>();
    for (String name : new ArrayList<>(found.held.keySet())) found.equip(name);
  }

  public List<String> auditLog(String bot) {
    List<String> log = bot(bot).log;
    return log == null ? new ArrayList<>() : new ArrayList<>(log);
  }
}
