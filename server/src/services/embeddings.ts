import { GoogleGenerativeAI } from "@google/generative-ai";
import type { CodeChunk } from "../types/index.js";

// gemini-embedding-001 is the current free-tier embedding model.
// It exposes embedContent (single text) but NOT batchEmbedContents.
//
// Empirical free-tier rate limit is *much* lower than the 1500 RPM
// docs imply. 8 parallel calls (~320 RPM effective) were rejected
// instantly even with a brand-new API key. 3 parallel @ 2s pacing
// keeps us around 90 RPM effective — safely under the real ceiling
// while still giving runtime ingestion enough throughput for usable UX.
const MODEL = "models/gemini-embedding-001";
const BATCH_SIZE = 3;
const BATCH_DELAY_MS = 2000;
const MAX_RETRIES = 4;

function getModel(apiKey?: string) {
  const key = apiKey ?? process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");
  const genAI = new GoogleGenerativeAI(key);
  return genAI.getGenerativeModel({ model: MODEL });
}

function chunkToText(chunk: CodeChunk): string {
  return [
    `File: ${chunk.filePath}`,
    `Type: ${chunk.type}`,
    chunk.name ? `Name: ${chunk.name}` : null,
    chunk.content,
  ].filter(Boolean).join("\n");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function embedOne(
  model: ReturnType<typeof getModel>,
  text: string,
  attempt = 0
): Promise<number[]> {
  try {
    const result = await model.embedContent(text);
    return result.embedding.values;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isRateLimit = msg.includes("429") || msg.toLowerCase().includes("rate") || msg.toLowerCase().includes("quota");
    if (isRateLimit && attempt < MAX_RETRIES) {
      // Exponential backoff: 3s, 6s, 12s, 24s. The free tier's rate
      // window is on the order of seconds, so shorter waits often hit
      // the same throttle immediately.
      const backoffMs = 3000 * Math.pow(2, attempt);
      console.warn(`Embed rate-limited (attempt ${attempt + 1}/${MAX_RETRIES}), backing off ${backoffMs}ms`);
      await sleep(backoffMs);
      return embedOne(model, text, attempt + 1);
    }
    throw err;
  }
}

// Loader retained for API compatibility with index.ts — Gemini has no model to warm.
export async function loadEmbeddingModel(): Promise<void> {
  if (!process.env.GEMINI_API_KEY) {
    console.warn("WARN: GEMINI_API_KEY not set — embedding requests will fail.");
  }
}

export async function embedChunks(
  chunks: CodeChunk[],
  onProgress?: (done: number, total: number) => void
): Promise<CodeChunk[]> {
  console.log(`Embedding ${chunks.length} chunks via Gemini (~90 RPM)…`);
  const model = getModel();

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const texts = batch.map(chunkToText);

    const embeddings = await Promise.all(texts.map((t) => embedOne(model, t)));
    for (let j = 0; j < batch.length; j++) {
      chunks[i + j].embedding = embeddings[j];
    }

    const done = Math.min(i + BATCH_SIZE, chunks.length);
    onProgress?.(done, chunks.length);
    if (done % 30 === 0 || done === chunks.length) {
      console.log(`  ${done}/${chunks.length}`);
    }

    if (i + BATCH_SIZE < chunks.length) await sleep(BATCH_DELAY_MS);
  }

  return chunks;
}

export async function embedQuery(query: string, apiKey?: string): Promise<number[]> {
  const model = getModel(apiKey);
  return embedOne(model, query);
}
