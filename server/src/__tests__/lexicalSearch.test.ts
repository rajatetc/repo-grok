import { describe, it, expect, beforeAll } from "vitest";
import { storeChunks } from "../services/vectorStore.js";
import { lexicalSearch, tokenizeQuery } from "../services/lexicalSearch.js";
import type { CodeChunk } from "../types/index.js";

function makeChunk(opts: {
  id: string;
  name?: string;
  filePath?: string;
  content?: string;
  type?: CodeChunk["type"];
}): CodeChunk {
  return {
    id: opts.id,
    name: opts.name,
    filePath: opts.filePath ?? `src/${opts.id}.ts`,
    content: opts.content ?? "",
    type: opts.type ?? "function",
    startLine: 1,
    endLine: 10,
    embedding: [0, 0, 0], // present so storeChunks doesn't filter it
  };
}

const repoId = "lexical-test-" + Date.now();

beforeAll(() => {
  storeChunks(repoId, [
    makeChunk({ id: "1", name: "createStore", filePath: "src/createStore.ts", content: "function createStore(reducer) { return store; }" }),
    makeChunk({ id: "2", name: "applyMiddleware", filePath: "src/applyMiddleware.ts", content: "function applyMiddleware(...middlewares) {}" }),
    makeChunk({ id: "3", name: "combineReducers", filePath: "src/combineReducers.ts", content: "function combineReducers(reducers) {}" }),
    makeChunk({ id: "4", name: "handleError", filePath: "src/errors.ts", content: "function handleError(err) { throw err; }" }),
    makeChunk({ id: "5", name: "Button", filePath: "src/ui/Button.tsx", content: "export function Button() { return null; }", type: "component" }),
  ]);
});

describe("tokenizeQuery", () => {
  it("lowercases, splits camelCase, and drops short tokens", () => {
    expect(tokenizeQuery("How does createStore work?")).toEqual(["create", "store", "work"]);
  });

  it("drops common stopwords", () => {
    expect(tokenizeQuery("how is the error handled")).toEqual(["error", "handled"]);
  });

  it("falls back to raw tokens if every word is a stopword", () => {
    const tokens = tokenizeQuery("how is it");
    expect(tokens.length).toBeGreaterThan(0);
  });

  it("returns empty array for whitespace / punctuation only", () => {
    expect(tokenizeQuery("?? !!  ")).toEqual([]);
  });
});

describe("lexicalSearch", () => {
  it("matches by chunk name", () => {
    const results = lexicalSearch(repoId, "createStore");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].chunk.name).toBe("createStore");
  });

  it("name match outranks content-only match", () => {
    // "Button" appears in name + path + content of chunk 5, only as a word
    // in nothing else. Sanity: top result is chunk 5.
    const results = lexicalSearch(repoId, "Button");
    expect(results[0].chunk.id).toBe("5");
  });

  it("scores zero-match chunks out", () => {
    const results = lexicalSearch(repoId, "createStore");
    for (const r of results) {
      expect(r.score).toBeGreaterThan(0);
    }
  });

  it("returns empty for an unknown repo", () => {
    expect(lexicalSearch("no-such-repo", "createStore")).toEqual([]);
  });

  it("returns empty when no chunk matches", () => {
    expect(lexicalSearch(repoId, "quantum cryptography blockchain")).toEqual([]);
  });

  it("respects topK", () => {
    const results = lexicalSearch(repoId, "function", { topK: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("ranks results by descending score", () => {
    const results = lexicalSearch(repoId, "createStore reducer");
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });
});
