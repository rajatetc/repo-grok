import type { IngestionStage } from "./hooks/useIngestionProgress";

export const EXAMPLES = [
  { owner: "reduxjs",    repo: "redux"   },
  { owner: "expressjs",  repo: "express" },
  { owner: "axios",      repo: "axios"   },
  { owner: "pmndrs",     repo: "zustand" },
  { owner: "colinhacks", repo: "zod"     },
];

export const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export const CHAT_SUGGESTIONS = [
  "What are the main exports and how do they connect?",
  "Walk me through the core flow",
  "What patterns and abstractions does this use?",
];

export const MAX_VISIBLE_SOURCES = 3;

export const INGESTION_STEPS: {
  id: IngestionStage;
  icon: string;
  label: string;
  tech: string;
  tooltip: { title: string; body: string };
}[] = [
  {
    id: "fetch", icon: "↓", label: "Fetch", tech: "Zip",
    tooltip: { title: "Fetch", body: "Downloads the repo as a single zip from GitHub. One HTTP call, all files at once." },
  },
  {
    id: "chunk", icon: "⚙", label: "Parse", tech: "Babel AST",
    tooltip: { title: "AST", body: "Babel turns your code into a syntax tree. We split by real boundaries — functions, components, hooks, classes — not arbitrary line counts." },
  },
  {
    id: "embed", icon: "✦", label: "Embed", tech: "BGE-small 384d",
    tooltip: { title: "Embeddings", body: "Each chunk becomes 384 numbers that capture its meaning. Similar code = similar vectors." },
  },
  {
    id: "done", icon: "◎", label: "Chat", tech: "RAG · Gemini",
    tooltip: { title: "RAG", body: "Your question is embedded the same way. The top matching chunks go to Gemini — not the whole codebase. That's retrieval-augmented generation." },
  },
];

export const STAGE_ORDER: IngestionStage[] = ["idle", "fetch", "chunk", "embed", "done"];
