import { getChunks, type SearchResult } from "./vectorStore.js";
import type { CodeChunk } from "../types/index.js";

// Lexical search used as a fallback when the embedding API is unavailable
// (e.g. Cloudflare daily neuron cap exhausted). Scores chunks by keyword
// overlap with the query, weighted toward structural signals (chunk name,
// file path, type) over raw content. Lower quality than vector search for
// concept-level questions but keeps the chat path alive during quota
// outages — see NOTES.md → Lexical fallback.

const STOPWORDS = new Set([
  "how", "what", "when", "where", "why", "who", "which",
  "do", "does", "did", "is", "are", "was", "were", "be", "been", "being",
  "the", "a", "an", "this", "that", "these", "those",
  "you", "your", "they", "their", "it", "its", "we", "our",
  "for", "with", "and", "or", "of", "in", "on", "to", "at", "by", "from",
  "about", "into", "out", "up", "down", "over", "under", "as", "but",
  "can", "could", "should", "would", "may", "might", "must",
  "tell", "show", "explain", "describe", "give", "find",
  "have", "has", "had", "get", "got",
]);

const MIN_TOKEN_LEN = 3;
const DEFAULT_TOP_K = 8;

const WEIGHT_NAME = 5;
const WEIGHT_PATH = 3;
const WEIGHT_TYPE = 2;
const WEIGHT_CONTENT = 1;

function tokenize(text: string): string[] {
  return text
    // Split camelCase / PascalCase so "isAuthenticated" matches a query like
    // "authentication". Most code uses these naming conventions; without
    // splitting, natural-language queries miss symbol-named chunks.
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= MIN_TOKEN_LEN);
}

export function tokenizeQuery(query: string): string[] {
  const all = tokenize(query);
  const filtered = all.filter((t) => !STOPWORDS.has(t));
  // If every token was a stopword (rare — e.g. "what is it"), fall back to
  // the unfiltered tokens so we don't return zero results.
  return filtered.length > 0 ? filtered : all;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!haystack) return 0;
  let count = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    count++;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return count;
}

function scoreChunk(chunk: CodeChunk, tokens: string[]): number {
  const name = (chunk.name ?? "").toLowerCase();
  const path = chunk.filePath.toLowerCase();
  const type = chunk.type.toLowerCase();
  const content = chunk.content.toLowerCase();
  let s = 0;
  for (const t of tokens) {
    s += countOccurrences(name, t)    * WEIGHT_NAME;
    s += countOccurrences(path, t)    * WEIGHT_PATH;
    s += countOccurrences(type, t)    * WEIGHT_TYPE;
    s += countOccurrences(content, t) * WEIGHT_CONTENT;
  }
  return s;
}

export interface LexicalSearchOptions {
  topK?: number;
}

export function lexicalSearch(
  repoId: string,
  query: string,
  options: LexicalSearchOptions = {}
): SearchResult[] {
  const { topK = DEFAULT_TOP_K } = options;
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return [];

  const chunks = getChunks(repoId);
  if (chunks.length === 0) return [];

  return chunks
    .map((chunk) => ({ chunk, score: scoreChunk(chunk, tokens) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
