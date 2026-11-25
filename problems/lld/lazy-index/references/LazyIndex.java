import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

// What callers see: the real index and its proxy answer the same calls.
interface SearchIndex {
  void addDoc(String id, String text);

  List<String> search(String term);

  boolean removeDoc(String id);
}

// A virtual proxy: it answers like the index, but holds only the raw documents until the
// first search needs the real one. After that, every change goes straight to the real
// index, one document at a time, so it's never built twice.
public class LazyIndex implements SearchIndex {
  private static final Pattern WORD = Pattern.compile("[a-z0-9]+");
  private static final Pattern TERM = Pattern.compile("[A-Za-z0-9]+");

  // The real subject: each term maps to the documents that contain it. Building it reads
  // every document, which is the work the proxy puts off.
  private static final class InvertedIndex implements SearchIndex {
    private final Map<String, Set<String>> postings = new HashMap<>();
    private final Map<String, Set<String>> docs = new HashMap<>();

    InvertedIndex(Map<String, String> pending) {
      for (Map.Entry<String, String> doc : pending.entrySet()) addDoc(doc.getKey(), doc.getValue());
    }

    public void addDoc(String id, String text) {
      removeDoc(id);
      Set<String> terms = new HashSet<>();
      Matcher words = WORD.matcher(text.toLowerCase(Locale.ROOT));
      while (words.find()) terms.add(words.group());
      docs.put(id, terms);
      for (String term : terms) postings.computeIfAbsent(term, t -> new HashSet<>()).add(id);
    }

    public List<String> search(String term) {
      List<String> ids = new ArrayList<>(postings.getOrDefault(term.toLowerCase(Locale.ROOT), Set.of()));
      Collections.sort(ids);
      return ids;
    }

    public boolean removeDoc(String id) {
      Set<String> terms = docs.remove(id);
      if (terms == null) return false;
      for (String term : terms) postings.get(term).remove(id);
      return true;
    }

    long size() {
      return docs.size();
    }
  }

  private final Map<String, String> pending = new HashMap<>();
  private InvertedIndex index = null;
  private long buildCount = 0;

  private InvertedIndex real() {
    if (index == null) {
      index = new InvertedIndex(pending);
      buildCount += 1;
    }
    return index;
  }

  public void addDoc(String id, String text) {
    if (id.isEmpty() || text.isEmpty()) throw new IllegalArgumentException("empty");
    if (index == null) pending.put(id, text);
    else index.addDoc(id, text);
  }

  public List<String> search(String term) {
    if (!TERM.matcher(term).matches()) throw new IllegalArgumentException("a term is letters and digits");
    return real().search(term);
  }

  public long builds() {
    return buildCount;
  }

  public long indexed() {
    return index == null ? 0 : index.size();
  }

  // The extension round: documents leave without a rebuild either.
  public boolean removeDoc(String id) {
    if (id.isEmpty()) throw new IllegalArgumentException("empty");
    if (index == null) return pending.remove(id) != null;
    return index.removeDoc(id);
  }
}
