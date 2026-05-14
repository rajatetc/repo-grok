import { describe, it, expect, beforeEach } from "vitest";
import { storeChunks, search, hasRepo, getChunks } from "../services/vectorStore.js";
import type { CodeChunk } from "../types/index.js";

function makeChunk(id: string, name: string, embedding: number[]): CodeChunk {
  return {
    id,
    filePath: `src/${name}.ts`,
    content: `function ${name}() {}`,
    type: "function",
    name,
    startLine: 1,
    endLine: 3,
    embedding,
  };
}

// Simple unit vectors for testing cosine similarity
const vecA = [1, 0, 0];
const vecB = [0, 1, 0];
const vecSimilarToA = [0.9, 0.1, 0];

describe("vectorStore", () => {
  const repoId = "test-repo-" + Date.now();

  beforeEach(() => {
    storeChunks(repoId, [
      makeChunk("1", "handleAuth", vecA),
      makeChunk("2", "formatDate", vecB),
      makeChunk("3", "validateToken", vecSimilarToA),
    ]);
  });

  it("stores and retrieves chunks", () => {
    expect(hasRepo(repoId)).toBe(true);
    expect(getChunks(repoId)).toHaveLength(3);
  });

  it("returns false for unknown repo", () => {
    expect(hasRepo("nonexistent")).toBe(false);
  });

  it("returns empty array for unknown repo search", () => {
    expect(search("nonexistent", vecA)).toEqual([]);
  });

  it("finds the most similar chunk first", () => {
    const results = search(repoId, vecA, { topK: 3, minScore: 0 });
    expect(results[0].chunk.name).toBe("handleAuth"); // exact match
    expect(results[0].score).toBeCloseTo(1, 4);
  });

  it("ranks similar vectors higher than orthogonal", () => {
    const results = search(repoId, vecA, { topK: 3, minScore: 0 });
    const names = results.map((r) => r.chunk.name);
    expect(names.indexOf("validateToken")).toBeLessThan(names.indexOf("formatDate"));
  });

  it("respects minScore threshold", () => {
    const results = search(repoId, vecA, { topK: 10, minScore: 0.5 });
    // formatDate (vecB) is orthogonal to vecA → score ≈ 0, should be excluded
    const names = results.map((r) => r.chunk.name);
    expect(names).not.toContain("formatDate");
  });

  it("respects topK limit", () => {
    const results = search(repoId, vecA, { topK: 1, minScore: 0 });
    expect(results).toHaveLength(1);
  });

  it("skips chunks without embeddings", () => {
    const noEmbed: CodeChunk = {
      id: "4",
      filePath: "src/broken.ts",
      content: "hello",
      type: "other",
      startLine: 1,
      endLine: 1,
    };
    const id2 = "test-repo-noembed";
    storeChunks(id2, [noEmbed, makeChunk("5", "good", vecA)]);
    expect(getChunks(id2)).toHaveLength(1); // only the one with embedding
  });
});
