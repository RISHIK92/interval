"use strict";

class ElevatorSystem {
  constructor(elevators, floors) {
    if (elevators < 1 || floors < 1)
      throw new RangeError("need an elevator and a floor");
    this.top = floors;
    this.at = new Array(elevators).fill(0);
    this.stops = Array.from({ length: elevators }, () => new Set());
    // The extension round: elevators out of service.
    this.out = new Array(elevators).fill(false);
  }

  elevator(e) {
    if (e < 0 || e >= this.at.length) throw new RangeError("unknown elevator");
  }

  floor(f) {
    if (f < 0 || f > this.top) throw new RangeError("unknown floor");
  }

  target(i) {
    let best = null;
    for (const s of this.stops[i]) {
      if (
        best === null ||
        Math.abs(s - this.at[i]) < Math.abs(best - this.at[i]) ||
        (Math.abs(s - this.at[i]) === Math.abs(best - this.at[i]) && s < best)
      )
        best = s;
    }
    return best;
  }

  dispatch(floor) {
    let best = -1;
    let bestCost = Infinity;
    for (let i = 0; i < this.at.length; i++) {
      if (this.out[i]) continue;
      if (this.stops[i].has(floor)) return i;
      const cost = Math.abs(this.at[i] - floor) + this.stops[i].size;
      if (cost < bestCost) {
        best = i;
        bestCost = cost;
      }
    }
    this.stops[best].add(floor);
    return best;
  }

  request(floor) {
    this.floor(floor);
    return this.dispatch(floor);
  }

  press(elevator, floor) {
    this.elevator(elevator);
    this.floor(floor);
    if (this.out[elevator]) throw new Error("out of service");
    if (this.stops[elevator].has(floor)) return false;
    this.stops[elevator].add(floor);
    return true;
  }

  step() {
    const opened = [];
    for (let i = 0; i < this.at.length; i++) {
      if (this.stops[i].size === 0) continue;
      const target = this.target(i);
      if (target > this.at[i]) this.at[i]++;
      else if (target < this.at[i]) this.at[i]--;
      if (this.stops[i].delete(this.at[i])) opened.push(`${i}:${this.at[i]}`);
    }
    return opened;
  }

  status(elevator) {
    this.elevator(elevator);
    const here = this.at[elevator];
    if (this.out[elevator]) return `${here} out -`;
    if (this.stops[elevator].size === 0) return `${here} idle -`;
    const target = this.target(elevator);
    const state = target === here ? "here" : target > here ? "up" : "down";
    return `${here} ${state} ${[...this.stops[elevator]].sort((a, b) => a - b).join(",")}`;
  }

  outOfService(elevator) {
    this.elevator(elevator);
    if (this.out[elevator]) return false;
    if (this.out.filter((o) => !o).length === 1)
      throw new Error("last elevator in service");
    this.out[elevator] = true;
    const pending = [...this.stops[elevator]].sort((a, b) => a - b);
    this.stops[elevator] = new Set();
    for (const floor of pending) this.dispatch(floor);
    return true;
  }
}

module.exports = { ElevatorSystem };
