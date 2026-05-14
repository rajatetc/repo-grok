import { describe, it, expect } from "vitest";
import { parseGitHubUrl } from "../services/github.js";

describe("parseGitHubUrl", () => {
  it("parses basic owner/repo", () => {
    expect(parseGitHubUrl("https://github.com/facebook/react")).toEqual({
      owner: "facebook",
      repo: "react",
      branch: undefined,
    });
  });

  it("strips trailing slash", () => {
    const { owner, repo } = parseGitHubUrl("https://github.com/facebook/react/");
    expect(owner).toBe("facebook");
    expect(repo).toBe("react");
  });

  it("strips .git suffix", () => {
    expect(parseGitHubUrl("https://github.com/facebook/react.git").repo).toBe("react");
  });

  it("parses branch from tree URL", () => {
    expect(parseGitHubUrl("https://github.com/facebook/react/tree/main").branch).toBe("main");
  });

  it("parses feature branch with slashes", () => {
    expect(
      parseGitHubUrl("https://github.com/facebook/react/tree/feat/new-feature").branch
    ).toBe("feat/new-feature");
  });

  it("throws on non-github hostname", () => {
    expect(() => parseGitHubUrl("https://gitlab.com/user/repo")).toThrow();
  });

  it("throws on http", () => {
    expect(() => parseGitHubUrl("http://github.com/user/repo")).toThrow();
  });

  it("throws on missing repo segment", () => {
    expect(() => parseGitHubUrl("https://github.com/facebook")).toThrow();
  });

  it("throws on blob path (not a tree URL)", () => {
    expect(() =>
      parseGitHubUrl("https://github.com/facebook/react/blob/main/README.md")
    ).toThrow();
  });

  it("throws on path traversal in branch", () => {
    expect(() =>
      parseGitHubUrl("https://github.com/facebook/react/tree/../evil")
    ).toThrow();
  });

  it("throws on credentials in URL", () => {
    expect(() =>
      parseGitHubUrl("https://user:pass@github.com/facebook/react")
    ).toThrow();
  });
});
