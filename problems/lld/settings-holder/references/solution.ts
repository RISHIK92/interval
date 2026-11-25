function filled(text: string): void {
  if (text === "") throw new RangeError("keys and values are not empty");
}

// The one loaded copy of the settings. Only the holder creates it, and only when
// something first needs a setting.
class Settings {
  readonly entries: ReadonlyMap<string, string>;

  constructor(source: ReadonlyMap<string, string>) {
    this.entries = new Map(source);
  }
}

export class SettingsHolder {
  private readonly source: ReadonlyMap<string, string>;
  private readonly overrides = new Map<string, string>();
  private settings: Settings | null = null;
  private loadCount = 0;

  constructor(defaults: Record<string, string>) {
    for (const [key, value] of Object.entries(defaults)) {
      filled(key);
      filled(value);
    }
    this.source = new Map(Object.entries(defaults));
  }

  // Every reader goes through here, so the settings are loaded on first use and once.
  private instance(): Settings {
    if (this.settings === null) {
      this.settings = new Settings(this.source);
      this.loadCount += 1;
    }
    return this.settings;
  }

  value(key: string): string | null {
    filled(key);
    const loaded = this.instance().entries;
    return this.overrides.get(key) ?? loaded.get(key) ?? null;
  }

  loads(): number {
    return this.loadCount;
  }

  overrideKey(key: string, value: string): void {
    filled(key);
    filled(value);
    this.overrides.set(key, value);
  }

  reload(): void {
    this.settings = null;
    this.overrides.clear();
  }

  // The extension round: a view of one prefix, read through the same single instance.
  scoped(prefix: string): Record<string, string> {
    filled(prefix);
    const merged = new Map([...this.instance().entries, ...this.overrides]);
    const out: Record<string, string> = {};
    for (const [k, v] of merged) if (k.startsWith(prefix)) out[k] = v;
    return out;
  }
}
