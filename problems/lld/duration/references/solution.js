"use strict";

const PATTERN = /^(?:([0-9]{1,9})h)?(?:([0-9]{1,9})m)?(?:([0-9]{1,9})s)?$/;

function seconds(text) {
  const match = PATTERN.exec(text);
  if (text === "" || match === null)
    throw new RangeError("a duration is like 1h30m15s");
  const [hours, minutes, secs] = match.slice(1).map((g) => Number(g ?? "0"));
  return hours * 3600 + minutes * 60 + secs;
}

function canonical(total) {
  if (total === 0) return "0s";
  const parts = [
    [Math.floor(total / 3600), "h"],
    [Math.floor(total / 60) % 60, "m"],
    [total % 60, "s"],
  ];
  return parts
    .filter(([amount]) => amount > 0)
    .map(([amount, unit]) => `${amount}${unit}`)
    .join("");
}

class Duration {
  #total;

  constructor(text) {
    this.#total = seconds(text);
  }

  totalSeconds() {
    return this.#total;
  }

  canonical() {
    return canonical(this.#total);
  }

  plus(other) {
    return canonical(this.#total + seconds(other));
  }

  isLonger(other) {
    return this.#total > seconds(other);
  }

  // The extension round.
  scaled(factor) {
    if (factor < 0 || factor > 1000)
      throw new RangeError("factor must be within 0-1000");
    return canonical(Math.floor(this.#total * factor));
  }
}

module.exports = { Duration };
