import { describe, it, expect } from "vitest";
import { normalizeUrl } from "../utils/normalizeUrl.js";

describe("normalizeUrl", () => {
  it("lowercases the URL", () => {
    expect(normalizeUrl("https://GitHub.com/Facebook/React")).toBe(
      "https://github.com/facebook/react"
    );
  });

  it("strips trailing slash", () => {
    expect(normalizeUrl("https://github.com/facebook/react/")).toBe(
      "https://github.com/facebook/react"
    );
  });

  it("strips .git suffix", () => {
    expect(normalizeUrl("https://github.com/facebook/react.git")).toBe(
      "https://github.com/facebook/react"
    );
  });

  it("trims whitespace", () => {
    expect(normalizeUrl("  https://github.com/facebook/react  ")).toBe(
      "https://github.com/facebook/react"
    );
  });

  it("handles URL with both .git and trailing slash", () => {
    expect(normalizeUrl("https://github.com/facebook/react.git/")).not.toContain(
      ".git"
    );
  });
});
