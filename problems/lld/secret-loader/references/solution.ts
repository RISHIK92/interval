// Stands in for the remote vault: each round trip is counted, and a rotation issues the
// next version of a secret.
class Vault {
  private readonly versions = new Map<string, number>();
  trips = 0;

  constructor(names: readonly string[]) {
    for (const name of names) this.versions.set(name, 1);
  }

  holds(name: string): boolean {
    return this.versions.has(name);
  }

  fetch(names: readonly string[]): [string, string][] {
    this.trips += 1;
    return names.map((name) => [
      name,
      `${name}#${String(this.versions.get(name))}`,
    ]);
  }

  rotate(name: string): void {
    this.versions.set(name, (this.versions.get(name) ?? 0) + 1);
  }
}

export class SecretLoader {
  private readonly vault: Vault;
  // A name is here only between its fetch and its next rotation.
  private readonly cache = new Map<string, string>();

  constructor(names: string[]) {
    if (names.includes("")) throw new RangeError("names are not empty");
    if (new Set(names).size < names.length)
      throw new RangeError("names are unique");
    this.vault = new Vault(names);
  }

  private known(name: string): void {
    if (!this.vault.holds(name)) throw new RangeError("unknown secret");
  }

  private warm(names: readonly string[]): void {
    for (const [n, secret] of this.vault.fetch(names))
      this.cache.set(n, secret);
  }

  reveal(name: string): string {
    this.known(name);
    let secret = this.cache.get(name);
    if (secret === undefined) {
      this.warm([name]);
      secret = this.cache.get(name) ?? "";
    }
    return secret;
  }

  fetches(): number {
    return this.vault.trips;
  }

  rotate(name: string): void {
    this.known(name);
    this.vault.rotate(name);
    this.cache.delete(name);
  }

  // The extension round: warm several secrets with one round trip.
  prefetch(names: string[]): number {
    for (const name of names) this.known(name);
    const cold = [...new Set(names)].filter((name) => !this.cache.has(name));
    if (cold.length > 0) this.warm(cold);
    return cold.length;
  }
}
