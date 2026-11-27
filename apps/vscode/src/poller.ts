import type { StatusResult } from "./api";

export const POLL_MS = 15_000;

// One check: what it found, the status it got (null when no request was sent: signed
// out, no site), and how to show it.
export type Check<C> = {
  readonly run: () => Promise<C>;
  readonly resultOf: (checked: C) => StatusResult | null;
  readonly show: (checked: C) => void;
  readonly log: (message: string) => void;
};

// Checks only while the window has focus (nobody sees the item otherwise), never
// sooner than the last answer allowed, one at a time; a click on the item checks
// through here too, so it shares the spacing and a 429's wait.
export class Poller<C> {
  readonly #check: Check<C>;
  #focused: boolean;
  #timer: ReturnType<typeof setTimeout> | undefined;
  // The earliest time (ms) the next scheduled check may start.
  #notBefore = 0;
  // Until when (ms) Interval asked for no requests (a 429): a setting change keeps it,
  // a new token clears it.
  #backOffUntil = 0;
  #inFlight: Promise<C | undefined> | undefined;
  // Bumped by every restart: a check that started before one is stale when it ends,
  // and is neither shown nor returned.
  #generation = 0;
  #tokenGeneration = 0;
  #disposed = false;

  constructor(check: Check<C>, focused: boolean) {
    this.#check = check;
    this.#focused = focused;
  }

  // The first check runs even in the background, so the item never sits on
  // "Checking…" until the window is next focused.
  start(): void {
    if (this.#disposed || this.#inFlight !== undefined) return;
    this.#clear();
    this.#timer = setTimeout(() => void this.#launch(), this.#wait(0));
  }

  setFocused(focused: boolean): void {
    this.#focused = focused;
    if (focused) this.#schedule(this.#wait(this.#notBefore));
    else this.#clear();
  }

  // The settings or the token changed: the last answer no longer says anything, but a
  // 429 still holds for the same token.
  restart({ newToken }: { readonly newToken: boolean }): void {
    this.#generation += 1;
    this.#notBefore = 0;
    if (newToken) {
      this.#tokenGeneration = this.#generation;
      this.#backOffUntil = 0;
    }
    if (this.#inFlight === undefined) this.#schedule(this.#wait(0));
  }

  // A check the user asked for: the one in flight if there is one, none at all while
  // a 429's wait lasts ("held"), and undefined if it went stale or threw.
  now(): Promise<C | "held" | undefined> {
    if (this.#disposed) return Promise.resolve(undefined);
    if (this.#inFlight !== undefined) return this.#inFlight;
    if (Date.now() < this.#backOffUntil) return Promise.resolve("held");
    return this.#launch();
  }

  dispose(): void {
    this.#disposed = true;
    this.#clear();
  }

  #wait(notBefore: number): number {
    return Math.max(0, Math.max(notBefore, this.#backOffUntil) - Date.now());
  }

  #schedule(ms: number): void {
    this.#clear();
    if (this.#disposed || !this.#focused || this.#inFlight !== undefined) {
      return;
    }
    this.#timer = setTimeout(() => void this.#launch(), ms);
  }

  #clear(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  #launch(): Promise<C | undefined> {
    this.#clear();
    const flight = this.#run();
    this.#inFlight = flight;
    return flight;
  }

  async #run(): Promise<C | undefined> {
    const generation = this.#generation;
    let checked: C | undefined;
    let delay: number | null = POLL_MS;
    try {
      const fresh = await this.#check.run();
      const result = this.#check.resultOf(fresh);
      // A 429 holds whatever changed since, unless the token did.
      if (
        result?.kind === "rateLimited" &&
        this.#tokenGeneration <= generation
      ) {
        this.#backOffUntil =
          Date.now() + Math.max(POLL_MS, result.retryAfterSeconds * 1000);
      }
      if (generation === this.#generation) {
        checked = fresh;
        this.#check.show(fresh);
        delay = result === null ? null : this.#delayAfter(result);
      }
    } catch (error) {
      this.#check.log(
        `Interval: a status check failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
      );
    } finally {
      this.#inFlight = undefined;
    }
    if (generation !== this.#generation) {
      // Settings or the token changed meanwhile: check again for them, after any
      // 429's wait.
      this.#schedule(this.#wait(0));
      return checked;
    }
    this.#notBefore = Date.now() + (delay ?? POLL_MS);
    if (delay !== null) this.#schedule(delay);
    return checked;
  }

  // A refused token, a plan without the hook or a redirect won't change by asking
  // again every 15 seconds: wait for the window's next focus or a restart.
  #delayAfter(result: StatusResult): number | null {
    switch (result.kind) {
      case "ok":
      case "failed":
        return POLL_MS;
      case "rateLimited":
        return this.#wait(0);
      case "refused":
      case "plan":
      case "redirect":
        return null;
    }
  }
}
