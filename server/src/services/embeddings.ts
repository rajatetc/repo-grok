import { GoogleGenerativeAI } from "@google/generative-ai";
import type { CodeChunk } from "../types/index.js";

// gemini-embedding-001 is the current free-tier embedding model.
// It exposes embedContent (single text) but NOT batchEmbedContents,
// so we parallelize within each batch and pace batches with a delay.
// Conservative numbers — Google's free tier throttles bursts, not just
// the 1500 RPM average. 8 parallel @ 1.5s pacing = ~5 RPS, well under limits.
const MODEL = "models/gemini-embedding-001";
const BATCH_SIZE = 8;
const BATCH_DELAY_MS = 1500;
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
      // Exponential backoff: 2s, 4s, 8s, 16s — Google's retryDelay hint
      // is typically 1s but bursts often need more recovery time than that.
      const backoffMs = 2000 * Math.pow(2, attempt);
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
  console.log(`Embedding ${chunks.length} chunks via Gemini…`);
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
    if (done % 100 === 0 || done === chunks.length) {
      console.log(`  ${done}/${chunks.length}`);
    }

    // Pace batches so we stay well under the 1500 RPM free-tier limit.
    if (i + BATCH_SIZE < chunks.length) await sleep(BATCH_DELAY_MS);
  }

  return chunks;
}

export async function embedQuery(query: string, apiKey?: string): Promise<number[]> {
  const model = getModel(apiKey);
  return embedOne(model, query);
}
