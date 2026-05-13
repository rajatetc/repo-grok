import { GoogleGenerativeAI } from "@google/generative-ai";
import type { CodeChunk } from "../types/index.js";

// gemini-embedding-001 is the current free-tier embedding model (replaces text-embedding-004).
// It supports embedContent but NOT batchEmbedContents, so we parallelize within each batch.
const EMBEDDING_MODEL = "models/gemini-embedding-001";
// Free tier: 1500 RPM. 10 concurrent keeps us at ~600 RPM peak, well clear of the limit.
const BATCH_SIZE = 10;
// Pause between batches to avoid sustained rate pressure
const BATCH_DELAY_MS = 500;

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

async function embedOne(text: string, attempt = 0): Promise<number[]> {
  try {
    const model = getModel();
    const result = await model.embedContent(text);
    return result.embedding.values;
  } catch (err) {
    const isRateLimit = (err as { status?: number }).status === 429;
    if (isRateLimit && attempt < 3) {
      const delay = (attempt + 1) * 5000; // 5s, 10s, 15s
      console.warn(`Rate limited by Gemini, retrying in ${delay / 1000}s...`);
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
