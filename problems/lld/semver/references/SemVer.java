import java.util.*;

public class SemVer {
  private final long[] version;

  public SemVer(String text) {
    this.version = parse(text);
  }

  // Each part is 1 to 9 digits with no leading zero.
  private static long[] parse(String text) {
    String[] parts = text.split("\\.", -1);
    if (parts.length != 3) throw new IllegalArgumentException("a version is major.minor.patch");
    long[] out = new long[3];
    for (int i = 0; i < 3; i++) {
      String part = parts[i];
      if (!part.matches("[0-9]{1,9}")) throw new IllegalArgumentException("each part is 1 to 9 digits");
      if (part.charAt(0) == '0' && part.length() > 1) throw new IllegalArgumentException("no leading zeros");
      out[i] = Long.parseLong(part);
    }
    return out;
  }

  private static int compare(long[] a, long[] b) {
    for (int i = 0; i < 3; i++) if (a[i] != b[i]) return a[i] < b[i] ? -1 : 1;
    return 0;
  }

  private static boolean compatible(long[] a, long[] b) {
    if (a[0] != b[0]) return false;
    return a[0] > 0 || a[1] == b[1];
  }

  public String bump(String part) {
    long major = version[0], minor = version[1], patch = version[2];
    switch (part) {
      case "major": return (major + 1) + ".0.0";
      case "minor": return major + "." + (minor + 1) + ".0";
      case "patch": return major + "." + minor + "." + (patch + 1);
      default: throw new IllegalArgumentException("part is major, minor or patch");
    }
  }

  public long compareTo(String other) {
    return compare(version, parse(other));
  }

  public boolean isCompatible(String other) {
    return compatible(version, parse(other));
  }

  public String text() {
    return version[0] + "." + version[1] + "." + version[2];
  }

  // The extension round.
  public boolean satisfies(String constraint) {
    if (!constraint.startsWith("^") && !constraint.startsWith("~"))
      throw new IllegalArgumentException("a constraint is ^ or ~ and a version");
    long[] base = parse(constraint.substring(1));
    if (compare(version, base) < 0) return false;
    if (constraint.charAt(0) == '^') return compatible(version, base);
    return version[0] == base[0] && version[1] == base[1];
  }
}
