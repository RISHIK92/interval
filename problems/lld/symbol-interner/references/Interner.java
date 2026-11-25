import java.util.*;

// The flyweight factory: hands out the one shared symbol for a text, making it only the
// first time the text is seen.
public class Interner {
  // The flyweight: one immutable record per distinct text, shared by every occurrence.
  private record Symbol(long id, String text) {}

  private final Map<String, Symbol> byText = new HashMap<>();
  private final List<Symbol> byId = new ArrayList<>();
  private long saved = 0;

  public long intern(String text) {
    if (text.isEmpty()) throw new IllegalArgumentException("empty text");
    Symbol shared = byText.get(text);
    if (shared != null) {
      saved += text.length();
      return shared.id();
    }
    Symbol symbol = new Symbol(byId.size(), text);
    byText.put(text, symbol);
    byId.add(symbol);
    return symbol.id();
  }

  public String lookup(long id) {
    if (id < 0 || id >= byId.size()) throw new IllegalArgumentException("unknown id");
    return byId.get((int) id).text();
  }

  public long size() {
    return byId.size();
  }

  public long bytesSaved() {
    return saved;
  }
}
