import java.util.*;

// Pull requests and people are associated, never owned: a pull request holds the names
// of its author and reviewers, and each reviewer's queue holds pull request ids.
public class ReviewQueue {
  private static final class PullRequest {
    final String author;
    final Set<String> requested = new HashSet<>();
    final Set<String> approved = new HashSet<>();

    PullRequest(String author) {
      this.author = author;
    }
  }

  private final Map<String, PullRequest> prs = new HashMap<>();
  private final Map<String, List<String>> pending = new HashMap<>();
  private final List<String[]> owners = new ArrayList<>();

  public ReviewQueue() {}

  private static void named(String... names) {
    for (String n : names) if (n.isEmpty()) throw new IllegalArgumentException("ids and names are not empty");
  }

  private PullRequest get(String pr) {
    PullRequest found = prs.get(pr);
    if (found == null) throw new IllegalArgumentException("unknown pull request");
    return found;
  }

  public void open(String pr, String author) {
    named(pr, author);
    if (prs.containsKey(pr)) throw new IllegalArgumentException("pull request already opened");
    prs.put(pr, new PullRequest(author));
  }

  public boolean request(String pr, String reviewer) {
    named(pr, reviewer);
    PullRequest found = get(pr);
    if (reviewer.equals(found.author) || found.requested.contains(reviewer)) return false;
    found.requested.add(reviewer);
    pending.computeIfAbsent(reviewer, k -> new ArrayList<>()).add(pr);
    return true;
  }

  public boolean approve(String pr, String reviewer) {
    named(pr, reviewer);
    PullRequest found = get(pr);
    if (!found.requested.contains(reviewer) || found.approved.contains(reviewer)) return false;
    found.approved.add(reviewer);
    pending.get(reviewer).remove(pr);
    return true;
  }

  public List<String> pendingFor(String reviewer) {
    named(reviewer);
    return new ArrayList<>(pending.getOrDefault(reviewer, List.of()));
  }

  public long approvals(String pr) {
    named(pr);
    return get(pr).approved.size();
  }

  // The extension round: owners of a path prefix are requested when it's touched.
  public void codeowner(String pathPrefix, String reviewer) {
    named(pathPrefix, reviewer);
    for (String[] o : owners) if (o[0].equals(pathPrefix) && o[1].equals(reviewer)) return;
    owners.add(new String[] {pathPrefix, reviewer});
  }

  public long touch(String pr, String path) {
    named(pr, path);
    get(pr);
    long added = 0;
    for (String[] o : owners) if (path.startsWith(o[0]) && request(pr, o[1])) added++;
    return added;
  }
}
