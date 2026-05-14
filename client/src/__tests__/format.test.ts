import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { timeAgo, fmtNum } from "../utils/format";

describe("fmtNum", () => {
  it("returns small numbers as-is", () => {
    expect(fmtNum(0)).toBe("0");
    expect(fmtNum(42)).toBe("42");
    expect(fmtNum(999)).toBe("999");
  });

  it("formats thousands with one decimal and k suffix", () => {
    expect(fmtNum(1000)).toBe("1.0k");
    expect(fmtNum(1500)).toBe("1.5k");
    expect(fmtNum(12345)).toBe("12.3k");
  });
});

describe("timeAgo", () => {
  // Pin time so the assertions are deterministic across runs
  const NOW = new Date("2026-05-14T12:00:00Z").getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  function offset(ms: number) {
    return new Date(NOW - ms).toISOString();
  }

  it("returns minutes for under an hour", () => {
    expect(timeAgo(offset(30 * 60 * 1000))).toBe("30m ago");
  });

  it("returns hours for under a day", () => {
    expect(timeAgo(offset(5 * 60 * 60 * 1000))).toBe("5h ago");
  });

  it("returns days for under a month", () => {
    expect(timeAgo(offset(3 * 24 * 60 * 60 * 1000))).toBe("3d ago");
  });

  it("returns months for older", () => {
    expect(timeAgo(offset(90 * 24 * 60 * 60 * 1000))).toBe("3mo ago");
  });
});
