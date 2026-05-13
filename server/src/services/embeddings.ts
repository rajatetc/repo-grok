import { GoogleGenerativeAI } from "@google/generative-ai";
import type { CodeChunk } from "../types/index.js";

// gemini-embedding-001 is the current free-tier embedding model (replaces text-embedding-004).
// It supports embedContent but NOT batchEmbedContents, so we parallelize within each batch.
const EMBEDDING_MODEL = "models/gemini-embedding-001";
// Free tier hard limit: 100 RPM for embedContent.
// BATCH_SIZE=5 + BATCH_DELAY_MS=3500 → 5 * (60/3.7s) ≈ 80 RPM — safely under the cap.
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 3500;

function getModel() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  return genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Build a richer text representation for embedding.
// Including the file path and chunk type gives the vector more context —
// "Button component in src/components/Button.tsx" embeds differently than
// the raw code alone, improving retrieval accuracy.
function chunkToText(chunk: CodeChunk): string {
  const parts = [
    `File: ${chunk.filePath}`,
    `Type: ${chunk.type}`,
    chunk.name ? `Name: ${chunk.name}` : null,
    chunk.content,
  ];
  return parts.filter(Boolean).join("\n");
}

// Parse the retryDelay Google sends back (e.g. "57s" → 57000 ms).
// Falls back to null so callers can use their own escalating delay.
function parseRetryDelayMs(err: unknown): number | null {
  const e = err as { errorDetails?: Array<{ "@type"?: string; retryDelay?: string }> };
  const retryInfo = e.errorDetails?.find((d) => d["@type"]?.endsWith("RetryInfo"));
  if (!retryInfo?.retryDelay) return null;
  const match = retryInfo.retryDelay.match(/^(\d+)s$/);
  return match ? parseInt(match[1], 10) * 1000 : null;
}

async function embedOne(text: string, attempt = 0): Promise<number[]> {
  try {
    const model = getModel();
    const result = await model.embedContent(text);
    return result.embedding.values;
  } catch (err) {
    const isRateLimit = (err as { status?: number }).status === 429;
    if (isRateLimit && attempt < 5) {
      // Respect Google's own retryDelay when present; fall back to escalating backoff
      const apiDelay = parseRetryDelayMs(err);
      const base = apiDelay ?? (attempt + 1) * 12000; // 12s, 24s, 36s, 48s, 60s
      const jitter = Math.random() * 3000;
      const delay = base + jitter;
      console.warn(`Rate limited — retrying in ${(delay / 1000).toFixed(1)}s (attempt ${attempt + 1}/5)…`);
      await sleep(delay);
      return embedOne(text, attempt + 1);
    }
    throw err;
  }
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  return Promise.all(texts.map((text) => embedOne(text)));
}

// Embeds all chunks in parallel batches of 20, with a 500ms pause between batches.
// Mutates each chunk in-place by setting chunk.embedding.
// Returns the same array (with embeddings filled in) for convenience.
export async function embedChunks(chunks: CodeChunk[]): Promise<CodeChunk[]> {
  console.log(`Embedding ${chunks.length} chunks...`);

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const texts = batch.map(chunkToText);

    const vectors = await embedBatch(texts);
    vectors.forEach((vec, j) => {
      batch[j].embedding = vec;
    });

    const progress = Math.min(i + BATCH_SIZE, chunks.length);
    console.log(`  Embedded ${progress}/${chunks.length}`);

    if (i + BATCH_SIZE < chunks.length) await sleep(BATCH_DELAY_MS);
  }

  return chunks;
}

// Embed a single query string (used at search time, not ingestion time)
export async function embedQuery(query: string): Promise<number[]> {
  return embedOne(query);
}
