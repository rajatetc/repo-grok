import { pipeline } from "@xenova/transformers";
import type { CodeChunk } from "../types/index.js";

// all-MiniLM-L6-v2: 23MB, 384-dim vectors, good semantic similarity.
// Downloads once on first run and caches locally — no API calls ever.
const MODEL = "Xenova/all-MiniLM-L6-v2";

// Singleton — loading the model takes ~10s, so we do it once at startup.
let extractor: Awaited<ReturnType<typeof pipeline>> | null = null;

export async function loadEmbeddingModel(): Promise<void> {
  if (extractor) return;
  console.log("Loading embedding model (first run may download ~23MB)…");
  extractor = await pipeline("feature-extraction", MODEL);
  console.log("Embedding model ready.");
}

async function getExtractor() {
  if (!extractor) await loadEmbeddingModel();
  return extractor!;
}

function chunkToText(chunk: CodeChunk): string {
  return [
    `File: ${chunk.filePath}`,
    `Type: ${chunk.type}`,
    chunk.name ? `Name: ${chunk.name}` : null,
    chunk.content,
  ].filter(Boolean).join("\n");
}

async function embedText(text: string): Promise<number[]> {
  const model = await getExtractor();
  // Cast needed: @xenova/transformers returns a broad union type
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const output = await (model as any)(text, { pooling: "mean", normalize: true }) as { data: Float32Array };
  return Array.from(output.data);
}

export async function embedChunks(chunks: CodeChunk[]): Promise<CodeChunk[]> {
  console.log(`Embedding ${chunks.length} chunks locally…`);
  for (let i = 0; i < chunks.length; i++) {
    chunks[i].embedding = await embedText(chunkToText(chunks[i]));
    if ((i + 1) % 50 === 0 || i + 1 === chunks.length) {
      console.log(`  ${i + 1}/${chunks.length}`);
    }
  }
  return chunks;
}

export async function embedQuery(query: string): Promise<number[]> {
  return embedText(query);
}
