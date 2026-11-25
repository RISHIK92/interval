function named(...names: string[]): void {
  if (names.includes(""))
    throw new RangeError("names and images are not empty");
}

const byCode = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// A pod owns its containers: they are created inside it and go with it.
export class PodRegistry {
  private readonly pods = new Map<string, Map<string, string>>();
  private readonly podOfName = new Map<string, string>();
  private readonly sidecars = new Map<string, string>();

  createPod(pod: string): void {
    named(pod);
    if (this.pods.has(pod)) throw new RangeError("pod already exists");
    const injected = [...this.sidecars].map(
      ([name, image]): [string, string] => [`${pod}-${name}`, image],
    );
    if (injected.some(([name]) => this.podOfName.has(name)))
      throw new RangeError("a sidecar's name is taken");
    const owned = new Map<string, string>();
    this.pods.set(pod, owned);
    for (const [name, image] of injected) this.place(pod, owned, name, image);
  }

  private place(
    pod: string,
    owned: Map<string, string>,
    container: string,
    image: string,
  ): void {
    owned.set(container, image);
    this.podOfName.set(container, pod);
  }

  addContainer(pod: string, container: string, image: string): boolean {
    named(pod, container, image);
    const owned = this.pods.get(pod);
    if (owned === undefined || this.podOfName.has(container)) return false;
    this.place(pod, owned, container, image);
    return true;
  }

  removePod(pod: string): number {
    named(pod);
    const owned = this.pods.get(pod);
    if (owned === undefined) throw new RangeError("unknown pod");
    this.pods.delete(pod);
    for (const container of owned.keys()) this.podOfName.delete(container);
    return owned.size;
  }

  podOf(container: string): string | null {
    named(container);
    return this.podOfName.get(container) ?? null;
  }

  images(): string[] {
    const all = new Set<string>();
    for (const owned of this.pods.values())
      for (const image of owned.values()) all.add(image);
    return [...all].sort(byCode);
  }

  // The extension round: containers injected into every pod created afterwards.
  sidecar(container: string, image: string): void {
    named(container, image);
    if (this.sidecars.has(container))
      throw new RangeError("sidecar already registered");
    this.sidecars.set(container, image);
  }
}
