import java.util.*;

// A pod owns its containers: they are created inside it and go with it.
public class PodRegistry {
  private final Map<String, Map<String, String>> pods = new HashMap<>();
  private final Map<String, String> podOf = new HashMap<>();
  private final Map<String, String> sidecars = new LinkedHashMap<>();

  public PodRegistry() {}

  private static void named(String... names) {
    for (String n : names) if (n.isEmpty()) throw new IllegalArgumentException("names and images are not empty");
  }

  public void createPod(String pod) {
    named(pod);
    if (pods.containsKey(pod)) throw new IllegalArgumentException("pod already exists");
    Map<String, String> injected = new LinkedHashMap<>();
    for (Map.Entry<String, String> s : sidecars.entrySet()) injected.put(pod + "-" + s.getKey(), s.getValue());
    for (String name : injected.keySet())
      if (podOf.containsKey(name)) throw new IllegalArgumentException("a sidecar's name is taken");
    pods.put(pod, new HashMap<>());
    for (Map.Entry<String, String> c : injected.entrySet()) place(pod, c.getKey(), c.getValue());
  }

  private void place(String pod, String container, String image) {
    pods.get(pod).put(container, image);
    podOf.put(container, pod);
  }

  public boolean addContainer(String pod, String container, String image) {
    named(pod, container, image);
    if (!pods.containsKey(pod) || podOf.containsKey(container)) return false;
    place(pod, container, image);
    return true;
  }

  public long removePod(String pod) {
    named(pod);
    Map<String, String> owned = pods.remove(pod);
    if (owned == null) throw new IllegalArgumentException("unknown pod");
    for (String container : owned.keySet()) podOf.remove(container);
    return owned.size();
  }

  public String podOf(String container) {
    named(container);
    return podOf.get(container);
  }

  public List<String> images() {
    TreeSet<String> all = new TreeSet<>();
    for (Map<String, String> owned : pods.values()) all.addAll(owned.values());
    return new ArrayList<>(all);
  }

  // The extension round: containers injected into every pod created afterwards.
  public void sidecar(String container, String image) {
    named(container, image);
    if (sidecars.containsKey(container)) throw new IllegalArgumentException("sidecar already registered");
    sidecars.put(container, image);
  }
}
