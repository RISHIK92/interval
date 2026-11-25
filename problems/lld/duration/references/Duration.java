import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class Duration {
  private static final Pattern PATTERN =
      Pattern.compile("(?:([0-9]{1,9})h)?(?:([0-9]{1,9})m)?(?:([0-9]{1,9})s)?");
  private final long total;

  public Duration(String text) {
    this.total = seconds(text);
  }

  private static long seconds(String text) {
    Matcher m = PATTERN.matcher(text);
    if (text.isEmpty() || !m.matches()) throw new IllegalArgumentException("a duration is like 1h30m15s");
    return part(m, 1) * 3600 + part(m, 2) * 60 + part(m, 3);
  }

  private static long part(Matcher m, int group) {
    String g = m.group(group);
    return g == null ? 0 : Long.parseLong(g);
  }

  private static String canonical(long total) {
    if (total == 0) return "0s";
    StringBuilder out = new StringBuilder();
    if (total / 3600 > 0) out.append(total / 3600).append('h');
    if (total / 60 % 60 > 0) out.append(total / 60 % 60).append('m');
    if (total % 60 > 0) out.append(total % 60).append('s');
    return out.toString();
  }

  public long totalSeconds() {
    return total;
  }

  public String canonical() {
    return canonical(total);
  }

  public String plus(String other) {
    return canonical(total + seconds(other));
  }

  public boolean isLonger(String other) {
    return total > seconds(other);
  }

  // The extension round.
  public String scaled(double factor) {
    if (factor < 0 || factor > 1000) throw new IllegalArgumentException("factor must be within 0-1000");
    return canonical((long) Math.floor(total * factor));
  }
}
