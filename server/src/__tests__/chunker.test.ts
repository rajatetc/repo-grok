import { describe, it, expect } from "vitest";
import { chunkFile } from "../services/chunker.js";
import type { RepoFile } from "../types/index.js";

function file(path: string, content: string): RepoFile {
  return { path, content, size: content.length };
}

describe("chunkFile — type detection", () => {
  it("detects a React component (PascalCase function)", () => {
    const chunks = chunkFile(file("src/Button.tsx", `
      export function Button({ label }: { label: string }) {
        return <button>{label}</button>;
      }
    `));
    const btn = chunks.find(c => c.name === "Button");
    expect(btn?.type).toBe("component");
  });

  it("detects a custom hook (use* prefix)", () => {
    const chunks = chunkFile(file("src/useCounter.ts", `
      export function useCounter(initial: number) {
        const [count, setCount] = React.useState(initial);
        return { count, setCount };
      }
    `));
    const hook = chunks.find(c => c.name === "useCounter");
    expect(hook?.type).toBe("hook");
  });

  it("detects a plain function (camelCase)", () => {
    const chunks = chunkFile(file("src/utils.ts", `
      export function formatDate(date: Date): string {
        return date.toISOString();
      }
    `));
    const fn = chunks.find(c => c.name === "formatDate");
    expect(fn?.type).toBe("function");
  });

  it("detects a class", () => {
    const chunks = chunkFile(file("src/Service.ts", `
      export class AuthService {
        login(user: string) { return true; }
      }
    `));
    const cls = chunks.find(c => c.name === "AuthService");
    expect(cls?.type).toBe("class");
  });

  it("detects a TypeScript interface", () => {
    const chunks = chunkFile(file("src/types.ts", `
      export interface User {
        id: string;
        email: string;
      }
    `));
    const iface = chunks.find(c => c.name === "User");
    expect(iface?.type).toBe("type");
  });

  it("detects a TypeScript type alias", () => {
    const chunks = chunkFile(file("src/types.ts", `
      export type ButtonVariant = "primary" | "secondary" | "ghost";
    `));
    const t = chunks.find(c => c.name === "ButtonVariant");
    expect(t?.type).toBe("type");
  });

  it("detects arrow function component", () => {
    const chunks = chunkFile(file("src/Card.tsx", `
      export const Card = ({ title }: { title: string }) => {
        return <div>{title}</div>;
      };
    `));
    const card = chunks.find(c => c.name === "Card");
    expect(card?.type).toBe("component");
  });

  it("groups all imports into a single chunk", () => {
    const chunks = chunkFile(file("src/index.ts", `
      import React from "react";
      import { useState } from "react";
      import { formatDate } from "./utils";
    `));
    const importChunks = chunks.filter(c => c.type === "import");
    expect(importChunks).toHaveLength(1);
    expect(importChunks[0].content).toContain("import React");
    expect(importChunks[0].content).toContain("formatDate");
  });

  it("falls back gracefully on unparseable content", () => {
    const chunks = chunkFile(file("src/broken.ts", "{{{{ not valid typescript >>>>"));
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].type).toBe("other");
  });
});

describe("chunkFile — line numbers", () => {
  it("records correct start line for a function", () => {
    const chunks = chunkFile(file("src/fn.ts", `
const x = 1;

export function greet(name: string) {
  return \`hello \${name}\`;
}
    `.trim()));
    const fn = chunks.find(c => c.name === "greet");
    expect(fn?.startLine).toBeGreaterThan(1);
  });
});
