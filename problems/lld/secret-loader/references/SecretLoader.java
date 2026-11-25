import java.util.*;

public class SecretLoader {
  // Stands in for the remote vault: each round trip is counted, and a rotation issues
  // the next version of a secret.
  private static final class Vault {
    private final Map<String, Long> versions = new HashMap<>();
    long trips;

    Vault(List<String> names) {
      for (String name : names) versions.put(name, 1L);
    }

    boolean holds(String name) {
      return versions.containsKey(name);
    }

    Map<String, String> fetch(Collection<String> names) {
      trips += 1;
      Map<String, String> out = new HashMap<>();
      for (String name : names) out.put(name, name + "#" + versions.get(name));
      return out;
    }

    void rotate(String name) {
      versions.merge(name, 1L, Long::sum);
    }
  }

  private final Vault vault;
  // A name is here only between its fetch and its next rotation.
  private final Map<String, String> cache = new HashMap<>();

  public SecretLoader(List<String> names) {
    if (names.contains("")) throw new IllegalArgumentException("names are not empty");
    if (new HashSet<>(names).size() < names.size())
      throw new IllegalArgumentException("names are unique");
    vault = new Vault(names);
  }

  private void known(String name) {
    if (!vault.holds(name)) throw new NoSuchElementException("unknown secret");
  }

  public String reveal(String name) {
    known(name);
    if (!cache.containsKey(name)) cache.putAll(vault.fetch(List.of(name)));
    return cache.get(name);
  }

  public long fetches() {
    return vault.trips;
  }

  public void rotate(String name) {
    known(name);
    vault.rotate(name);
    cache.remove(name);
  }

  // The extension round: warm several secrets with one round trip.
  public long prefetch(List<String> names) {
    for (String name : names) known(name);
    Set<String> cold = new HashSet<>(names);
    cold.removeAll(cache.keySet());
    if (!cold.isEmpty()) cache.putAll(vault.fetch(cold));
    return cold.size();
  }
}
