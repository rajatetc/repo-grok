import { describe, it, expect } from "vitest";
import { parseGitHubUrl, buildFolderTree } from "../services/github.js";
import type { RepoFile } from "../types/index.js";

function f(path: string): RepoFile {
  return { path, content: "", size: 0 };
}

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

describe("buildFolderTree", () => {
  it("returns an empty root for no files", () => {
    const root = buildFolderTree([]);
    expect(root.type).toBe("directory");
    expect(root.children).toEqual([]);
  });

  it("places a root-level file as a single file child", () => {
    const root = buildFolderTree([f("README.md")]);
    expect(root.children).toHaveLength(1);
    expect(root.children![0]).toMatchObject({ name: "README.md", type: "file" });
  });

  it("creates a directory node for nested files", () => {
    const root = buildFolderTree([f("src/index.ts")]);
    const src = root.children!.find((c) => c.name === "src");
    expect(src?.type).toBe("directory");
    expect(src?.children).toHaveLength(1);
    expect(src?.children![0]).toMatchObject({ name: "index.ts", type: "file" });
  });

  it("merges multiple files in the same directory under one node", () => {
    const root = buildFolderTree([f("src/a.ts"), f("src/b.ts"), f("src/c.ts")]);
    const src = root.children!.find((c) => c.name === "src");
    expect(src?.children).toHaveLength(3);
    expect(src?.children!.every((c) => c.type === "file")).toBe(true);
  });

  it("nests deep paths correctly", () => {
    const root = buildFolderTree([f("src/components/ui/Button.tsx")]);
    const src = root.children!.find((c) => c.name === "src");
    const components = src!.children!.find((c) => c.name === "components");
    const ui = components!.children!.find((c) => c.name === "ui");
    expect(ui!.children![0].name).toBe("Button.tsx");
  });

  it("attaches sibling directories under the same parent", () => {
    const root = buildFolderTree([f("src/index.ts"), f("test/spec.ts")]);
    const names = root.children!.map((c) => c.name).sort();
    expect(names).toEqual(["src", "test"]);
  });
});
