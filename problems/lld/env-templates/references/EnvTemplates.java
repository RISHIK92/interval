import java.util.*;

public class EnvTemplates {
  // A prototype: anything made from it is a copy that shares no state with it. It
  // remembers the variables it started with, so it can tell what changed since.
  private static final class Environment {
    final Map<String, String> variables;
    final Map<String, String> started;

    Environment(Map<String, String> variables) {
      this.variables = new HashMap<>(variables);
      this.started = Map.copyOf(variables);
    }

    Environment copy() {
      return new Environment(variables);
    }
  }

  private static void filled(String text) {
    if (text.isEmpty()) throw new IllegalArgumentException("names, keys and values are not empty");
  }

  private final Map<String, Environment> templates = new HashMap<>();
  private final Map<String, Environment> envs = new HashMap<>();

  private Environment env(String env) {
    Environment found = envs.get(env);
    if (found == null) throw new NoSuchElementException("unknown environment");
    return found;
  }

  public void define(String name, Map<String, String> vars) {
    filled(name);
    for (Map.Entry<String, String> e : vars.entrySet()) {
      filled(e.getKey());
      filled(e.getValue());
    }
    templates.put(name, new Environment(vars));
  }

  public boolean fork(String base, String env) {
    filled(env);
    Environment template = templates.get(base);
    if (template == null) throw new NoSuchElementException("unknown template");
    if (envs.containsKey(env)) return false;
    envs.put(env, template.copy());
    return true;
  }

  public boolean setVar(String env, String key, String value) {
    Environment found = env(env);
    filled(key);
    filled(value);
    if (value.equals(found.variables.get(key))) return false;
    found.variables.put(key, value);
    return true;
  }

  public Map<String, String> vars(String env) {
    return new HashMap<>(env(env).variables);
  }

  // The extension round: what an environment changed since it was forked.
  public List<String> diff(String env) {
    Environment found = env(env);
    List<String> out = new ArrayList<>();
    for (Map.Entry<String, String> e : new TreeMap<>(found.variables).entrySet()) {
      String was = found.started.get(e.getKey());
      if (was == null) out.add("+" + e.getKey() + "=" + e.getValue());
      else if (!was.equals(e.getValue())) out.add("~" + e.getKey() + "=" + e.getValue());
    }
    return out;
  }
}
