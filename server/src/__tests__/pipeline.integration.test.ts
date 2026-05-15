import { describe, it, expect, beforeAll } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chunkFiles } from "../services/chunker.js";
import { storeChunks, search } from "../services/vectorStore.js";
import { lexicalSearch } from "../services/lexicalSearch.js";
import type { CodeChunk, RepoFile } from "../types/index.js";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/sample-repo");

// Synthetic embedding for tests: hash-bucketed bag-of-words. Same text always
// produces the same vector, and texts sharing tokens produce similar vectors.
// Lets the integration test exercise the real vector-search code path without
// touching Cloudflare or burning real neurons.
const DIMS = 64;
function fakeEmbed(text: string): number[] {
  const v = new Array(DIMS).fill(0);
  const tokens = text.toLowerCase().match(/[a-z]+/g) ?? [];
  for (const t of tokens) {
    let h = 0;
    for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0;
    v[((h % DIMS) + DIMS) % DIMS] += 1;
  }
  const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return mag > 0 ? v.map((x) => x / mag) : v;
}

async function loadFixtureFiles(): Promise<RepoFile[]> {
  const names = await readdir(FIXTURE_DIR);
  const files: RepoFile[] = [];
  for (const name of names) {
    const content = await readFile(join(FIXTURE_DIR, name), "utf-8");
    files.push({ path: `src/${name}`, content, size: content.length });
  }
  return files;
}

describe("ingestion pipeline (integration)", () => {
  const repoId = "fixture-test-" + Date.now();
  let chunks: CodeChunk[] = [];

  beforeAll(async () => {
    const files = await loadFixtureFiles();
    chunks = chunkFiles(files);
    // Real chunker output, synthetic embeddings. Embed name + content together
    // so the vector reflects both, mirroring what the real embedder does via
    // chunkToText (file path + type + name + content).
    for (const c of chunks) c.embedding = fakeEmbed((c.name ?? "") + " " + c.content);
    storeChunks(repoId, chunks);
  });

  it("chunks the fixture into recognized semantic types", () => {
    expect(chunks.length).toBeGreaterThan(0);
    const types = new Set(chunks.map((c) => c.type));
    expect(types.has("function")).toBe(true);
    expect(types.has("hook")).toBe(true);
    expect(types.has("class")).toBe(true);
    expect(types.has("component")).toBe(true);
    expect(types.has("type")).toBe(true);
  });

  it("extracts the expected named chunks", () => {
    const names = new Set(chunks.map((c) => c.name).filter(Boolean));
    expect(names.has("createUser")).toBe(true);
    expect(names.has("deleteUser")).toBe(true);
    expect(names.has("UserCard")).toBe(true);
    expect(names.has("useAuth")).toBe(true);
    expect(names.has("UserRepository")).toBe(true);
    expect(names.has("validateEmail")).toBe(true);
  });

  it("vector search returns results for a known query", () => {
    const queryVec = fakeEmbed("createUser");
    const results = search(repoId, queryVec, { minScore: 0 });
    expect(results.length).toBeGreaterThan(0);
    // The chunk named createUser should appear in the top results
    const topNames = results.slice(0, 5).map((r) => r.chunk.name);
    expect(topNames).toContain("createUser");
  });

  it("vector search ranks tightly-related chunks higher than unrelated ones", () => {
    const queryVec = fakeEmbed("useAuth authentication");
    const results = search(repoId, queryVec, { minScore: 0 });
    const useAuthIdx = results.findIndex((r) => r.chunk.name === "useAuth");
    const userCardIdx = results.findIndex((r) => r.chunk.name === "UserCard");
    expect(useAuthIdx).toBeGreaterThanOrEqual(0);
    if (useAuthIdx >= 0 && userCardIdx >= 0) {
      expect(useAuthIdx).toBeLessThan(userCardIdx);
    }
  });

  it("lexical fallback finds chunks by keyword", () => {
    const results = lexicalSearch(repoId, "validateEmail");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].chunk.name).toBe("validateEmail");
  });

  it("lexical fallback handles natural-language queries via stopword filtering", () => {
    // "How does the auth hook work?" → ["auth", "hook", "work"] after stopwords
    const results = lexicalSearch(repoId, "How does the auth hook work?");
    expect(results.length).toBeGreaterThan(0);
    const topNames = results.slice(0, 3).map((r) => r.chunk.name);
    expect(topNames).toContain("useAuth");
  });

  it("returns empty when nothing matches", () => {
    expect(lexicalSearch(repoId, "quantum cryptography blockchain")).toEqual([]);
  });
});
