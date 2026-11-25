const CHANNELS = ["email", "push", "sms"]; // sorted

function check(user: string, channel?: string): void {
  if (user === "") throw new RangeError("a user is not empty");
  if (channel !== undefined && !CHANNELS.includes(channel))
    throw new RangeError("unknown channel");
}

function checkHour(hour: number): void {
  if (hour < 0 || hour > 23) throw new RangeError("an hour is from 0 to 23");
}

// When a user doesn't want to be disturbed; knows nothing about channels. The same
// start and end is an empty window.
class QuietHours {
  private readonly start: number;
  private readonly end: number;

  constructor(start: number, end: number) {
    this.start = start;
    this.end = end;
  }

  contains(hour: number): boolean {
    if (this.start <= this.end) return hour >= this.start && hour < this.end;
    return hour >= this.start || hour < this.end; // wraps past midnight
  }
}

// What one user chose. It answers questions about itself and never routes.
class Preferences {
  private readonly optedOut = new Set<string>();
  private quiet: QuietHours | null = null;
  private readonly digested = new Set<string>();
  private readonly held = new Map<string, number>(); // channel -> messages held for the digest

  optOut(channel: string): void {
    this.optedOut.add(channel);
    this.held.delete(channel);
  }

  setQuiet(quiet: QuietHours): void {
    this.quiet = quiet;
  }

  receives(channel: string): boolean {
    return !this.optedOut.has(channel);
  }

  isQuiet(hour: number): boolean {
    return this.quiet !== null && this.quiet.contains(hour);
  }

  useDigest(channel: string): void {
    this.digested.add(channel);
  }

  // Holds a message for the digest when the channel uses one.
  holds(channel: string): boolean {
    const held = this.digested.has(channel);
    if (held) this.held.set(channel, (this.held.get(channel) ?? 0) + 1);
    return held;
  }

  flush(): number {
    const total = [...this.held.values()].reduce((sum, n) => sum + n, 0);
    this.held.clear();
    return total;
  }
}

// Keeps preferences and decides delivery; sending is someone else's job.
export class NotificationPrefs {
  private readonly users = new Map<string, Preferences>();

  private prefs(user: string): Preferences {
    let found = this.users.get(user);
    if (found === undefined) {
      found = new Preferences();
      this.users.set(user, found);
    }
    return found;
  }

  optOut(user: string, channel: string): void {
    check(user, channel);
    this.prefs(user).optOut(channel);
  }

  quietHours(user: string, startHour: number, endHour: number): void {
    check(user);
    checkHour(startHour);
    checkHour(endHour);
    this.prefs(user).setQuiet(new QuietHours(startHour, endHour));
  }

  route(user: string, channel: string, hour: number, urgent: boolean): boolean {
    check(user, channel);
    checkHour(hour);
    const prefs = this.users.get(user);
    if (prefs === undefined) return true;
    if (!prefs.receives(channel)) return false;
    if (urgent) return true;
    return !prefs.holds(channel) && !prefs.isQuiet(hour);
  }

  channels(user: string): string[] {
    check(user);
    const prefs = this.users.get(user);
    return CHANNELS.filter((c) => prefs === undefined || prefs.receives(c));
  }

  // The extension round: non-urgent messages on a digest channel wait for the digest.
  digest(user: string, channel: string): void {
    check(user, channel);
    this.prefs(user).useDigest(channel);
  }

  flushDigest(user: string): number {
    check(user);
    return this.users.get(user)?.flush() ?? 0;
  }
}
