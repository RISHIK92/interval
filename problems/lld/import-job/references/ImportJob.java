import java.util.*;

public class ImportJob {
  private static final int FIELDS = 3;
  private static final long MAX_AGE = 150;
  private static final long MAX_SECONDS = 1_000_000_000L;
  private static final long MS_PER_SECOND = 1000;
  private static final Set<String> EVENT_TYPES = Set.of("click", "view", "buy");

  // A whole number written without leading zeros, at most `most`; null otherwise.
  private static Long whole(String text, long most) {
    if (text.isEmpty() || text.length() > 10 || (text.length() > 1 && text.charAt(0) == '0')) return null;
    for (char c : text.toCharArray()) if (c < '0' || c > '9') return null;
    long n = Long.parseLong(text);
    return n > most ? null : n;
  }

  // The template method: `run` fixes the skeleton (extract, validate, transform,
  // optionally dedupe, load) and each kind fills in only the steps that differ.
  private abstract static class Importer {
    final List<String> loaded = new ArrayList<>();
    final List<String> rejects = new ArrayList<>();
    private final Set<String> keys = new HashSet<>();
    private long runs = 0;

    abstract String validate(String[] fields);

    abstract String transform(String[] fields);

    abstract String key(String[] fields);

    final Map<String, Long> run(List<String> lines, boolean dedupe) {
      if (lines.contains("")) throw new IllegalArgumentException("an empty line");
      runs++;
      long loadedNow = 0;
      long rejected = 0;
      long duplicates = 0;
      for (int i = 0; i < lines.size(); i++) {
        String[] fields = lines.get(i).split(",", -1);
        String reason = fields.length != FIELDS ? "fields" : validate(fields);
        if (reason != null) {
          rejects.add(runs + ":" + (i + 1) + " " + reason);
          rejected++;
          continue;
        }
        String key = key(fields);
        if (dedupe && keys.contains(key)) {
          duplicates++;
          continue;
        }
        keys.add(key);
        loaded.add(transform(fields));
        loadedNow++;
      }
      Map<String, Long> counts = new HashMap<>();
      counts.put("read", (long) lines.size());
      counts.put("loaded", loadedNow);
      counts.put("rejected", rejected);
      if (dedupe) counts.put("duplicates", duplicates);
      return counts;
    }
  }

  // email,name,age
  private static final class UserImporter extends Importer {
    String validate(String[] fields) {
      String email = fields[0];
      int at = email.indexOf('@');
      if (at < 1 || at == email.length() - 1 || email.indexOf('@', at + 1) >= 0) return "email";
      if (fields[1].isEmpty()) return "name";
      if (whole(fields[2], MAX_AGE) == null) return "age";
      return null;
    }

    String transform(String[] fields) {
      return "user:" + fields[0].toLowerCase(Locale.ROOT) + ":" + fields[1] + ":" + fields[2];
    }

    String key(String[] fields) {
      return fields[0].toLowerCase(Locale.ROOT);
    }
  }

  // ts,type,user, with ts in seconds
  private static final class EventImporter extends Importer {
    String validate(String[] fields) {
      if (whole(fields[0], MAX_SECONDS) == null) return "ts";
      if (!EVENT_TYPES.contains(fields[1])) return "type";
      if (fields[2].isEmpty()) return "user";
      return null;
    }

    String transform(String[] fields) {
      return "event:" + Long.parseLong(fields[0]) * MS_PER_SECOND + ":" + fields[1] + ":" + fields[2];
    }

    String key(String[] fields) {
      return transform(fields);
    }
  }

  private final Importer importer;
  private boolean deduping = false;

  public ImportJob(String kind) {
    if (kind.equals("users")) importer = new UserImporter();
    else if (kind.equals("events")) importer = new EventImporter();
    else throw new IllegalArgumentException("unknown kind");
  }

  public Map<String, Long> runImport(List<String> lines) {
    return importer.run(lines, deduping);
  }

  public List<String> loaded() {
    return new ArrayList<>(importer.loaded);
  }

  public List<String> rejects() {
    return new ArrayList<>(importer.rejects);
  }

  // The extension round: the skeleton's optional step, switched on or off.
  public void dedupe(boolean on) {
    deduping = on;
  }
}
