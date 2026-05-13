import { GoogleGenerativeAI } from "@google/generative-ai";
import type { CodeChunk } from "../types/index.js";

// text-embedding-004 is free tier, 100 RPM, up to 100 texts per batch call
const EMBEDDING_MODEL = "text-embedding-004";
const BATCH_SIZE = 100;
// Pause between batches to stay under the 100 RPM free-tier limit
const BATCH_DELAY_MS = 1000;

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

async function embedBatch(texts: string[]): Promise<number[][]> {
  const model = getModel();
  const result = await model.batchEmbedContents({
    requests: texts.map((text) => ({
      content: { parts: [{ text }], role: "user" },
    })),
  });
  return result.embeddings.map((e) => e.values);
}

// Embeds all chunks in batches of 100, with a 1s pause between batches.
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

    // Don't sleep after the last batch
    if (i + BATCH_SIZE < chunks.length) await sleep(BATCH_DELAY_MS);
  }

  return chunks;
}

// Embed a single query string (used at search time, not ingestion time)
export async function embedQuery(query: string): Promise<number[]> {
  const model = getModel();
  const result = await model.embedContent(query);
  return result.embedding.values;
}
