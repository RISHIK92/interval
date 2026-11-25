"use strict";

function filled(text) {
  if (text === "") throw new RangeError("keys and values are not empty");
}

// The one loaded copy of the settings. Only the holder creates it, and only when
// something first needs a setting.
class Settings {
  constructor(source) {
    this.entries = new Map(source);
  }
}

class SettingsHolder {
  #source;
  #overrides = new Map();
  #settings = null;
  #loads = 0;

  constructor(defaults) {
    for (const [key, value] of Object.entries(defaults)) {
      filled(key);
      filled(value);
    }
    this.#source = new Map(Object.entries(defaults));
  }

  // Every reader goes through here, so the settings are loaded on first use and once.
  #instance() {
    if (this.#settings === null) {
      this.#settings = new Settings(this.#source);
      this.#loads += 1;
    }
    return this.#settings;
  }

  value(key) {
    filled(key);
    const loaded = this.#instance().entries;
    return this.#overrides.get(key) ?? loaded.get(key) ?? null;
  }

  loads() {
    return this.#loads;
  }

  overrideKey(key, value) {
    filled(key);
    filled(value);
    this.#overrides.set(key, value);
  }

  reload() {
    this.#settings = null;
    this.#overrides.clear();
  }

  // The extension round: a view of one prefix, read through the same single instance.
  scoped(prefix) {
    filled(prefix);
    const merged = new Map([...this.#instance().entries, ...this.#overrides]);
    const out = {};
    for (const [k, v] of merged) if (k.startsWith(prefix)) out[k] = v;
    return out;
  }
}

module.exports = { SettingsHolder };
