import { describe, it, expect } from "vitest";
import { nextProgressState, IDLE_STATE, DONE_STATE } from "../hooks/useIngestionProgress";

describe("nextProgressState", () => {
  it("maps fetch event to 15% / fetch stage", () => {
    expect(nextProgressState({ stage: "fetch" })).toEqual({ percent: 15, stage: "fetch" });
  });

  it("maps chunk event to 30% / chunk stage", () => {
    expect(nextProgressState({ stage: "chunk", total: 423 })).toEqual({ percent: 30, stage: "chunk" });
  });

  it("scales embed progress between 30 and 90", () => {
    // 0% of chunks embedded → still at 30%
    expect(nextProgressState({ stage: "embed", done: 0, total: 100 }).percent).toBe(30);
    // halfway → 60%
    expect(nextProgressState({ stage: "embed", done: 50, total: 100 }).percent).toBe(60);
    // all embedded → 90% (the final +10% comes from onDone)
    expect(nextProgressState({ stage: "embed", done: 100, total: 100 }).percent).toBe(90);
  });

  it("rounds embed percent to a whole number", () => {
    const state = nextProgressState({ stage: "embed", done: 7, total: 100 });
    expect(Number.isInteger(state.percent)).toBe(true);
  });
});

describe("IDLE_STATE / DONE_STATE constants", () => {
  it("idle is 0% / idle", () => {
    expect(IDLE_STATE).toEqual({ percent: 0, stage: "idle" });
  });

  it("done is 100% / done", () => {
    expect(DONE_STATE).toEqual({ percent: 100, stage: "done" });
  });
});
