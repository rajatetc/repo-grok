import { pipeline, type FeatureExtractionPipeline } from "@xenova/transformers";
import type { CodeChunk } from "../types/index.js";

// all-MiniLM-L6-v2: 23MB, 384-dim vectors, good semantic similarity.
// Downloads once on first run and caches locally — no API calls ever.
const MODEL = "Xenova/all-MiniLM-L6-v2";
const HIDDEN_SIZE = 384;
const EMBED_BATCH_SIZE = 64;

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

export async function embedChunks(chunks: CodeChunk[]): Promise<CodeChunk[]> {
  console.log(`Embedding ${chunks.length} chunks locally…`);
  const model = await getExtractor();

  for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
    const texts = batch.map(chunkToText);

    // Pass the whole batch in one inference call; output.data is a flat
    // Float32Array of shape [batch_size × HIDDEN_SIZE].
    const output = await (model as FeatureExtractionPipeline)(texts, {
      pooling: "mean",
      normalize: true,
    }) as { data: Float32Array };

    for (let j = 0; j < batch.length; j++) {
      const start = j * HIDDEN_SIZE;
      chunks[i + j].embedding = Array.from(output.data.subarray(start, start + HIDDEN_SIZE));
    }

    const done = Math.min(i + EMBED_BATCH_SIZE, chunks.length);
    if (done % 320 === 0 || done === chunks.length) {
      console.log(`  ${done}/${chunks.length}`);
    }
  }

  return chunks;
}

export async function embedQuery(query: string): Promise<number[]> {
  const model = await getExtractor();
  const output = await model(query, { pooling: "mean", normalize: true }) as { data: Float32Array };
  return Array.from(output.data);
}
