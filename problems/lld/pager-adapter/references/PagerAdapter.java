import java.util.*;

// Lets the incident API (team names, sev1 to sev3) drive a legacy pager (numeric team
// codes, levels 1 to 5): pages go out as legacy lines, and the pager's acknowledgements
// come back as the API's words. Numbers are kept as the text the pager sees.
public class PagerAdapter {
  // The incident API's severities as the legacy pager's levels, and back: five levels
  // fold into three severities.
  private static final Map<String, String> TO_LEVEL = Map.of("sev1", "1", "sev2", "3", "sev3", "5");
  private static final Map<String, String> TO_SEVERITY =
      Map.of("1", "sev1", "2", "sev1", "3", "sev2", "4", "sev3", "5", "sev3");
  private static final long MAX_CODE = 9999;

  private static final class Page {
    final String team;
    final String code;
    boolean acked = false;

    Page(String team, String code) {
      this.team = team;
      this.code = code;
    }
  }

  private final Map<String, String> codes = new HashMap<>();
  private final Map<String, Page> sent = new HashMap<>();

  public PagerAdapter(Map<String, Long> teamCodes) {
    for (Map.Entry<String, Long> e : teamCodes.entrySet()) {
      if (e.getKey().isEmpty() || e.getValue() < 1 || e.getValue() > MAX_CODE)
        throw new IllegalArgumentException("bad team or code");
      codes.put(e.getKey(), String.valueOf(e.getValue()));
    }
    if (new HashSet<>(codes.values()).size() != codes.size())
      throw new IllegalArgumentException("two teams share a code");
  }

  public String page(String team, String severity, String summary) {
    String code = codes.get(team);
    String level = TO_LEVEL.get(severity);
    if (code == null || level == null || summary.isEmpty())
      throw new IllegalArgumentException("unknown team or severity, or no summary");
    String number = String.valueOf(sent.size() + 1);
    sent.put(number, new Page(team, code));
    return "PAGE " + number + " " + code + " " + level + " " + summary;
  }

  public String ack(String legacyLine) {
    if (legacyLine.isEmpty()) throw new IllegalArgumentException("empty line");
    String[] fields = legacyLine.split(" ", -1);
    if (fields.length != 4 || !fields[0].equals("ACK")) return null;
    Page page = sent.get(fields[1]);
    String severity = TO_SEVERITY.get(fields[3]);
    if (page == null || page.acked || !page.code.equals(fields[2]) || severity == null) return null;
    page.acked = true;
    return page.team + " acked page " + fields[1] + " at " + severity;
  }

  public long pages() {
    return sent.size();
  }
}
