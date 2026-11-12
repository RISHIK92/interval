export class Bank {
  private readonly accounts = new Map<string, number>();
  // The extension round: frozen accounts send and receive nothing.
  private readonly frozen = new Set<string>();

  private get(account: string): number {
    const balance = this.accounts.get(account);
    if (balance === undefined) throw new RangeError("unknown account");
    return balance;
  }

  open(account: string, balance: number): void {
    if (balance < 0) throw new RangeError("negative opening balance");
    if (this.accounts.has(account)) throw new Error("account exists");
    this.accounts.set(account, balance);
  }

  deposit(account: string, amount: number): number {
    if (amount <= 0) throw new RangeError("amount must be positive");
    const balance = this.get(account) + amount;
    this.accounts.set(account, balance);
    return balance;
  }

  withdraw(account: string, amount: number): boolean {
    if (amount <= 0) throw new RangeError("amount must be positive");
    const balance = this.get(account);
    this.unfrozen(account);
    if (balance < amount) return false;
    this.accounts.set(account, balance - amount);
    return true;
  }

  transfer(source: string, target: string, amount: number): boolean {
    if (amount <= 0) throw new RangeError("amount must be positive");
    if (source === target)
      throw new RangeError("a transfer needs two accounts");
    const from = this.get(source);
    const to = this.get(target);
    this.unfrozen(source);
    this.unfrozen(target);
    if (from < amount) return false;
    this.accounts.set(source, from - amount);
    this.accounts.set(target, to + amount);
    return true;
  }

  private unfrozen(account: string): void {
    if (this.frozen.has(account)) throw new Error("account frozen");
  }

  freeze(account: string): void {
    this.get(account);
    this.frozen.add(account);
  }

  unfreeze(account: string): void {
    this.get(account);
    this.frozen.delete(account);
  }

  isFrozen(account: string): boolean {
    this.get(account);
    return this.frozen.has(account);
  }

  balance(account: string): number {
    return this.get(account);
  }

  total(): number {
    let sum = 0;
    for (const b of this.accounts.values()) sum += b;
    return sum;
  }
}
