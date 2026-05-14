import { describe, it, expect } from "vitest";
import { detectTechStack } from "../utils/techDetector.js";
import type { RepoFile } from "../types/index.js";

function pkg(
  deps: Record<string, string> = {},
  devDeps: Record<string, string> = {}
): RepoFile[] {
  return [
    {
      path: "package.json",
      content: JSON.stringify({ dependencies: deps, devDependencies: devDeps }),
      size: 100,
    },
  ];
}

function configFile(name: string): RepoFile {
  return { path: name, content: "", size: 10 };
}

describe("detectTechStack", () => {
  it("detects React as framework", () => {
    expect(detectTechStack(pkg({ react: "^18.0.0" })).framework).toBe("React");
  });

  it("detects Next.js from dep", () => {
    expect(detectTechStack(pkg({ next: "^14.0.0" })).framework).toBe("Next.js");
  });

  it("detects Next.js from config file when not in deps", () => {
    const stack = detectTechStack([configFile("next.config.js")]);
    expect(stack.framework).toBe("Next.js");
  });

  it("detects Redux via react-redux", () => {
    const stack = detectTechStack(pkg({ "react-redux": "^8.0.0" }));
    expect(stack.stateManagement).toContain("Redux");
  });

  it("detects Zustand in state management", () => {
    expect(detectTechStack(pkg({ zustand: "^4.0.0" })).stateManagement).toContain("Zustand");
  });

  it("detects multiple state libs together", () => {
    const stack = detectTechStack(pkg({ redux: "^4.0.0", zustand: "^4.0.0" }));
    expect(stack.stateManagement).toContain("Redux");
    expect(stack.stateManagement).toContain("Zustand");
  });

  it("detects Vitest in testing", () => {
    expect(detectTechStack(pkg({}, { vitest: "^1.0.0" })).testing).toContain("Vitest");
  });

  it("detects Jest in testing", () => {
    expect(detectTechStack(pkg({}, { jest: "^29.0.0" })).testing).toContain("Jest");
  });

  it("detects Tailwind from config file", () => {
    const stack = detectTechStack([configFile("tailwind.config.ts")]);
    expect(stack.styling).toContain("Tailwind CSS");
  });

  it("detects Prisma with correct label (not package name)", () => {
    const stack = detectTechStack(pkg({ prisma: "^5.0.0" }));
    expect(stack.backend).toContain("Prisma");
    expect(stack.backend).not.toContain("@prisma/client");
  });

  it("detects Express as backend", () => {
    expect(detectTechStack(pkg({ express: "^4.0.0" })).backend).toContain("Express");
  });

  it("returns empty stack for unknown packages", () => {
    const stack = detectTechStack(pkg({ "totally-unknown-lib": "^1.0.0" }));
    expect(stack.framework).toBeUndefined();
    expect(stack.stateManagement).toBeUndefined();
    expect(stack.testing).toBeUndefined();
  });

  it("handles malformed package.json gracefully", () => {
    const files: RepoFile[] = [{ path: "package.json", content: "not json {{{", size: 10 }];
    expect(() => detectTechStack(files)).not.toThrow();
  });

  it("ignores devDependency-only packages for runtime categories", () => {
    // zustand has redux in devDeps for testing its middleware adapter
    const stack = detectTechStack(pkg({ zustand: "^4.0.0" }, { redux: "^4.0.0" }));
    expect(stack.stateManagement).toContain("Zustand");
    expect(stack.stateManagement).not.toContain("Redux");
  });

  it("detects testing libs from devDependencies", () => {
    const stack = detectTechStack(pkg({}, { vitest: "^1.0.0", jest: "^29.0.0" }));
    expect(stack.testing).toContain("Vitest");
    expect(stack.testing).toContain("Jest");
  });

  it("detects build tools from devDependencies", () => {
    const stack = detectTechStack(pkg({}, { vite: "^5.0.0" }));
    expect(stack.buildTool).toBe("Vite");
  });
});
