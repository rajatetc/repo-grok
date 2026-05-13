import type { CodeChunk, ChunkType } from "../types/index.js";

export interface SearchResult {
  chunk: CodeChunk;
  score: number; // cosine similarity: 0 (no match) → 1 (perfect match)
}

export interface SearchOptions {
  topK?: number;        // how many results to return (default 8)
  minScore?: number;    // minimum similarity threshold (default 0.3)
  filterType?: ChunkType[]; // optionally restrict to specific chunk types
}

// In-memory store: one entry per ingested repo
// key = repoId, value = all embedded chunks for that repo
const store = new Map<string, CodeChunk[]>();

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
export function storeChunks(repoId: string, chunks: CodeChunk[]): void {
  // Only keep chunks that actually have embeddings
  const embedded = chunks.filter((c) => c.embedding && c.embedding.length > 0);
  store.set(repoId, embedded);
  console.log(`Stored ${embedded.length} embedded chunks for repo ${repoId}`);
}

// Search for the most relevant chunks given a query embedding vector.
// This is the core of RAG — instead of sending the whole codebase to the LLM,
// we send only the top-k most relevant chunks.
export function search(
  repoId: string,
  queryEmbedding: number[],
  options: SearchOptions = {}
): SearchResult[] {
  const { topK = 8, minScore = 0.3, filterType } = options;

  const chunks = store.get(repoId);
  if (!chunks || chunks.length === 0) return [];

  let candidates = chunks;
  if (filterType && filterType.length > 0) {
    candidates = chunks.filter((c) => filterType.includes(c.type));
  }

  return candidates
    .map((chunk) => ({
      chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding!),
    }))
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

export function getChunks(repoId: string): CodeChunk[] {
  return store.get(repoId) ?? [];
}

export function hasRepo(repoId: string): boolean {
  return store.has(repoId);
}

export function deleteRepo(repoId: string): void {
  store.delete(repoId);
}
