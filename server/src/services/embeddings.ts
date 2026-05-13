import { pipeline, type FeatureExtractionPipeline } from "@xenova/transformers";
import type { CodeChunk } from "../types/index.js";

// all-MiniLM-L6-v2: 23MB, 384-dim vectors, good semantic similarity.
// Downloads once on first run and caches locally — no API calls ever.
const MODEL = "Xenova/all-MiniLM-L6-v2";

// Promise-cached singleton — multiple concurrent calls safely share one load.
let modelPromise: ReturnType<typeof pipeline> | null = null;

export function loadEmbeddingModel(): ReturnType<typeof pipeline> {
  if (!modelPromise) {
    console.log("Loading embedding model (first run may download ~23MB)…");
    modelPromise = pipeline("feature-extraction", MODEL).then((m) => {
      console.log("Embedding model ready.");
      return m;
    });
  }
  return modelPromise;
}

async function getExtractor(): Promise<FeatureExtractionPipeline> {
  return loadEmbeddingModel() as Promise<FeatureExtractionPipeline>;
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
  const output = await model(text, { pooling: "mean", normalize: true });
  return Array.from((output as { data: Float32Array }).data);
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
