import { LRUCache } from "lru-cache";
import type { CodeChunk } from "../types/index.js";

export interface SearchResult {
  chunk: CodeChunk;
  score: number; // cosine similarity: 0 (no match) → 1 (perfect match)
}

export interface SearchOptions {
  topK?: number;        // how many results to return (default 8)
  minScore?: number;    // minimum similarity threshold (default 0.3)
}

// Seeds (example repos pre-baked at build time) are pinned for the lifetime
// of the process so the landing-page example chips are always "instant click."
// User-ingested repos live in a bounded LRU so total memory stays predictable
// on Render's 512MB free tier (see NOTES.md → Render 512MB tuning).
const USER_MAX_REPOS = 10;
const seedChunks = new Map<string, CodeChunk[]>();
const userChunks = new LRUCache<string, CodeChunk[]>({ max: USER_MAX_REPOS });

// --- Cosine similarity ---
// Measures the angle between two vectors.
// Result: 1 = identical direction (very relevant), 0 = orthogonal (unrelated), -1 = opposite
// We use dot product / (magnitude A * magnitude B)
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

// Store all embedded chunks for a repo. Called once after ingestion completes.
// Pass isSeed=true for pre-baked example repos — they bypass the LRU and stay
// pinned for the process lifetime.
export function storeChunks(repoId: string, chunks: CodeChunk[], isSeed = false): void {
  const embedded = chunks.filter((c) => c.embedding && c.embedding.length > 0);
  if (isSeed) seedChunks.set(repoId, embedded);
  else userChunks.set(repoId, embedded);
  console.log(`Stored ${embedded.length} embedded chunks for repo ${repoId}${isSeed ? " (seed)" : ""}`);
}

function getRepoChunks(repoId: string): CodeChunk[] | undefined {
  return seedChunks.get(repoId) ?? userChunks.get(repoId);
}

// Search for the most relevant chunks given a query embedding vector.
// This is the core of RAG — instead of sending the whole codebase to the LLM,
// we send only the top-k most relevant chunks.
export function search(
  repoId: string,
  queryEmbedding: number[],
  options: SearchOptions = {}
): SearchResult[] {
  const { topK = 8, minScore = 0.3 } = options;

  const chunks = getRepoChunks(repoId);
  if (!chunks || chunks.length === 0) return [];

  return chunks
    .map((chunk) => ({
      chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding!),
    }))
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

export function getChunks(repoId: string): CodeChunk[] {
  return getRepoChunks(repoId) ?? [];
}

export function hasRepo(repoId: string): boolean {
  return seedChunks.has(repoId) || userChunks.has(repoId);
}
