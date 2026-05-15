import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { RepoMetadata, CodeChunk, CachedAnswer } from "../types/index.js";
import { storeChunks } from "./vectorStore.js";
import { normalizeUrl } from "../utils/normalizeUrl.js";

const SEEDS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../seeds");

interface SeedFile {
  repoId: string;
  url: string;
  metadata: RepoMetadata;
  chunks: CodeChunk[];
  cachedAnswers?: CachedAnswer[];
}

interface LoadedSeeds {
  urlMap: Map<string, string>;
  metadataMap: Map<string, RepoMetadata>;
}

// repoId → normalizedQuestion → cached answer. Populated at boot from seed
// JSONs. Looked up before the embed/Gemini path so canned chip questions
// short-circuit to deterministic, demo-quality, $0-cost responses.
const cachedAnswersMap = new Map<string, Map<string, CachedAnswer>>();

function normalizeQuestion(q: string): string {
  return q
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function getCachedAnswer(repoId: string, question: string): CachedAnswer | undefined {
  return cachedAnswersMap.get(repoId)?.get(normalizeQuestion(question));
}

export async function loadSeeds(): Promise<LoadedSeeds> {
  const urlMap = new Map<string, string>();
  const metadataMap = new Map<string, RepoMetadata>();

  let files: string[];
  try {
    files = (await readdir(SEEDS_DIR)).filter((f) => f.endsWith(".json"));
  } catch {
    return { urlMap, metadataMap };
  }

  for (const file of files) {
    try {
      const raw = await readFile(join(SEEDS_DIR, file), "utf-8");
      const seed: SeedFile = JSON.parse(raw);

      storeChunks(seed.repoId, seed.chunks, true);
      metadataMap.set(seed.repoId, seed.metadata);
      urlMap.set(normalizeUrl(seed.url), seed.repoId);

      if (seed.cachedAnswers && seed.cachedAnswers.length > 0) {
        const m = new Map<string, CachedAnswer>();
        for (const ca of seed.cachedAnswers) {
          m.set(normalizeQuestion(ca.question), ca);
        }
        cachedAnswersMap.set(seed.repoId, m);
      }

      const cachedSuffix = seed.cachedAnswers?.length
        ? `, ${seed.cachedAnswers.length} cached answers`
        : "";
      console.log(`Seed loaded: ${seed.metadata.owner}/${seed.metadata.repo} — ${seed.chunks.length} chunks${cachedSuffix}`);
    } catch (err) {
      console.warn(`Failed to load seed ${file}:`, err);
    }
  }

  return { urlMap, metadataMap };
}
