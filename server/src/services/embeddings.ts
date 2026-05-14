import type { CodeChunk } from "../types/index.js";

// Cloudflare Workers AI — @cf/baai/bge-small-en-v1.5.
// 384-dim vectors, mean pooling, 512 max tokens per text.
// Free tier: 10,000 neurons/day shared across all models, ~5K-10K
// embed calls/day. 3000 RPM ceiling on the embeddings task as a whole.
// Supports up to 100 texts per request — so a typical repo (a few
// hundred chunks) fits in 3-5 API calls.
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = process.env.CLOUDFLARE_AI_TOKEN;
const MODEL = "@cf/baai/bge-small-en-v1.5";
const ENDPOINT = ACCOUNT_ID
  ? `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${MODEL}`
  : "";

const BATCH_SIZE = 100;          // CF's hard max per request
const MAX_CHARS_PER_TEXT = 1800; // BGE input limit is 512 tokens (~2000 chars); truncate defensively
const MAX_RETRIES = 3;
// Number of batches to send to Cloudflare in parallel. 4 is well under the
// 3000-RPM rate limit (we'd need 50/sec to hit it) and the latency-bound
// nature of the API means each parallel call slot is mostly waiting on
// network anyway. Cuts ingest time for big repos ~4x.
const PARALLEL_BATCHES = 4;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function chunkToText(chunk: CodeChunk): string {
  const text = [
    `File: ${chunk.filePath}`,
    `Type: ${chunk.type}`,
    chunk.name ? `Name: ${chunk.name}` : null,
    chunk.content,
  ].filter(Boolean).join("\n");
  return text.length > MAX_CHARS_PER_TEXT ? text.slice(0, MAX_CHARS_PER_TEXT) : text;
}

interface CfResponse {
  result?: { shape?: number[]; data?: number[][]; pooling?: string };
  success?: boolean;
  errors?: Array<{ code: number; message: string }>;
}

async function callCloudflare(texts: string[], attempt = 0): Promise<number[][]> {
  if (!ACCOUNT_ID || !TOKEN) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_TOKEN must be set");
  }

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: texts, pooling: "mean" }),
  });

  if (res.status === 429 && attempt < MAX_RETRIES) {
    const backoffMs = 1000 * Math.pow(2, attempt);
    console.warn(`Cloudflare rate-limited (attempt ${attempt + 1}/${MAX_RETRIES}), backing off ${backoffMs}ms`);
    await sleep(backoffMs);
    return callCloudflare(texts, attempt + 1);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Cloudflare embed failed: ${res.status} ${res.statusText} ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as CfResponse;
  if (!json.success || !json.result?.data) {
    const errMsg = json.errors?.[0]?.message ?? "unknown error";
    throw new Error(`Cloudflare embed error: ${errMsg}`);
  }
  return json.result.data;
}

export async function embedChunks(
  chunks: CodeChunk[],
  onProgress?: (done: number, total: number) => void
): Promise<CodeChunk[]> {
  console.log(`Embedding ${chunks.length} chunks via Cloudflare BGE (${PARALLEL_BATCHES}× parallel)…`);

  // Slice into batches up front so we can dispatch them in fixed-size waves.
  const batches: { startIdx: number; items: CodeChunk[] }[] = [];
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    batches.push({ startIdx: i, items: chunks.slice(i, i + BATCH_SIZE) });
  }

  let completed = 0;

  async function processBatch(batch: { startIdx: number; items: CodeChunk[] }) {
    const texts = batch.items.map(chunkToText);
    const embeddings = await callCloudflare(texts);
    for (let j = 0; j < batch.items.length; j++) {
      chunks[batch.startIdx + j].embedding = embeddings[j];
    }
    completed += batch.items.length;
    onProgress?.(completed, chunks.length);
    console.log(`  ${completed}/${chunks.length}`);
  }

  // Run PARALLEL_BATCHES at a time. Promise.all rejects fast on the first
  // failure — desirable here, we'd rather fail the whole ingest than store
  // a partially-embedded repo.
  for (let i = 0; i < batches.length; i += PARALLEL_BATCHES) {
    const wave = batches.slice(i, i + PARALLEL_BATCHES);
    await Promise.all(wave.map(processBatch));
  }

  return chunks;
}

export async function embedQuery(query: string): Promise<number[]> {
  const truncated = query.length > MAX_CHARS_PER_TEXT ? query.slice(0, MAX_CHARS_PER_TEXT) : query;
  const [embedding] = await callCloudflare([truncated]);
  return embedding;
}
