import java.util.*;

public class SettingsHolder {
  // The one loaded copy of the settings. Only the holder creates it, and only when
  // something first needs a setting.
  private static final class Settings {
    final Map<String, String> entries;

    Settings(Map<String, String> source) {
      entries = Map.copyOf(source);
    }
  }

  private static void filled(String text) {
    if (text.isEmpty()) throw new IllegalArgumentException("keys and values are not empty");
  }

  private final Map<String, String> source;
  private final Map<String, String> overrides = new HashMap<>();
  private Settings settings;
  private long loads;

  public SettingsHolder(Map<String, String> defaults) {
    for (Map.Entry<String, String> e : defaults.entrySet()) {
      filled(e.getKey());
      filled(e.getValue());
    }
    source = Map.copyOf(defaults);
  }

  // Every reader goes through here; synchronized so the settings load once even when
  // many threads ask for their first setting together.
  private synchronized Settings instance() {
    if (settings == null) {
      settings = new Settings(source);
      loads += 1;
    }
    return settings;
  }

  public synchronized String value(String key) {
    filled(key);
    Map<String, String> loaded = instance().entries;
    return overrides.getOrDefault(key, loaded.get(key));
  }

  public synchronized long loads() {
    return loads;
  }

  public synchronized void overrideKey(String key, String value) {
    filled(key);
    filled(value);
    overrides.put(key, value);
  }

  public synchronized void reload() {
    settings = null;
    overrides.clear();
  }

  // The extension round: a view of one prefix, read through the same single instance.
  public synchronized Map<String, String> scoped(String prefix) {
    filled(prefix);
    Map<String, String> merged = new HashMap<>(instance().entries);
    merged.putAll(overrides);
    Map<String, String> out = new HashMap<>();
    for (Map.Entry<String, String> e : merged.entrySet())
      if (e.getKey().startsWith(prefix)) out.put(e.getKey(), e.getValue());
    return out;
  }
}
