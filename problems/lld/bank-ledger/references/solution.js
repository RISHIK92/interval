"use strict";

class Bank {
  constructor() {
    this.accounts = new Map();
  }

  known(account) {
    if (!this.accounts.has(account)) throw new RangeError("unknown account");
  }

  open(account, balance) {
    if (balance < 0) throw new RangeError("negative opening balance");
    if (this.accounts.has(account)) throw new Error("account exists");
    this.accounts.set(account, balance);
  }

  deposit(account, amount) {
    if (amount <= 0) throw new RangeError("amount must be positive");
    this.known(account);
    this.accounts.set(account, this.accounts.get(account) + amount);
    return this.accounts.get(account);
  }

  withdraw(account, amount) {
    if (amount <= 0) throw new RangeError("amount must be positive");
    this.known(account);
    if (this.accounts.get(account) < amount) return false;
    this.accounts.set(account, this.accounts.get(account) - amount);
    return true;
  }

  transfer(source, target, amount) {
    if (amount <= 0) throw new RangeError("amount must be positive");
    if (source === target)
      throw new RangeError("a transfer needs two accounts");
    this.known(source);
    this.known(target);
    if (this.accounts.get(source) < amount) return false;
    this.accounts.set(source, this.accounts.get(source) - amount);
    this.accounts.set(target, this.accounts.get(target) + amount);
    return true;
  }

  balance(account) {
    this.known(account);
    return this.accounts.get(account);
  }

  total() {
    let sum = 0;
    for (const b of this.accounts.values()) sum += b;
    return sum;
  }
}

module.exports = { Bank };
