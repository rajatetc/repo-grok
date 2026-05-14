import axios from "axios";
import type { RepoMetadata } from "../types";
import { API_BASE } from "../constants";
import { useRepoStore } from "../store/useRepoStore";

const client = axios.create({ baseURL: API_BASE });

// Read the in-memory key from the store and attach it to every axios request
client.interceptors.request.use((config) => {
  const key = useRepoStore.getState().geminiKey;
  if (key) config.headers["X-Gemini-Key"] = key;
  return config;
});

function extractError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const serverMsg: string | undefined = err.response?.data?.error;
    if (serverMsg) return serverMsg;

    if (!err.response) {
      return "Cannot reach the server. Make sure it's running on port 3001.";
    }
    switch (err.response.status) {
      case 400: return "Invalid request — check the GitHub URL and try again.";
      case 404: return "Repo not found or not yet indexed.";
      case 429: return "Too many requests — wait a moment and try again.";
      case 500: return "Something went wrong on the server. Try again shortly.";
      default:  return `Request failed (${err.response.status}). Please try again.`;
    }
  }
  if (err instanceof Error) return err.message;
  return "An unexpected error occurred.";
}

export type IngestProgress =
  | { stage: "fetch" }
  | { stage: "chunk"; total: number }
  | { stage: "embed"; done: number; total: number };

// Returns a cleanup function — call it to abort the stream.
export function ingestRepoStream(
  url: string,
  onProgress: (p: IngestProgress) => void,
  onDone: (repoId: string, metadata: RepoMetadata) => void,
  onError: (msg: string) => void
): () => void {
  const controller = new AbortController();

  fetch(`${API_BASE}/api/repos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
    signal: controller.signal,
  }).then(async (res) => {
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}));
      onError(data.error || "Ingestion failed. Check the URL and try again.");
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let pendingEvent = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          pendingEvent = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          const raw = line.slice(6);
          if (pendingEvent === "done") {
            try {
              const { repoId, metadata } = JSON.parse(raw);
              onDone(repoId, metadata);
            } catch { onError("Invalid response from server."); }
            return;
          }
          if (pendingEvent === "error") {
            onError(raw || "Ingestion failed.");
            return;
          }
          if (pendingEvent === "progress") {
            try { onProgress(JSON.parse(raw)); } catch { /* ignore */ }
          }
          pendingEvent = "";
        } else if (line === "") {
          pendingEvent = "";
        }
      }
    }
  }).catch((err) => {
    if (err.name !== "AbortError") onError("Lost connection to server.");
  });

  return () => controller.abort();
}

export async function getOverview(repoId: string): Promise<RepoMetadata> {
  try {
    const { data } = await client.get(`/api/repos/${repoId}/overview`);
    return data;
  } catch (err) {
    throw new Error(extractError(err));
  }
}


// Returns a cleanup function — call it to close the SSE connection.
export function streamQuery(
  repoId: string,
  query: string,
  history: { role: "user" | "assistant"; content: string }[],
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (msg: string) => void,
  onSources?: (sources: string[]) => void
): () => void {
  const controller = new AbortController();

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const key = useRepoStore.getState().geminiKey;
  if (key) headers["X-Gemini-Key"] = key;

  fetch(`${API_BASE}/api/repos/${repoId}/query`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, history }),
    signal: controller.signal,
  }).then(async (res) => {
    if (!res.ok || !res.body) {
      onError("Query failed — please try again.");
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let pendingEvent = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          pendingEvent = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          const raw = line.slice(6);
          if (pendingEvent === "done") { onDone(); return; }
          if (pendingEvent === "error") { onError(raw || "Stream error from server."); return; }
          if (pendingEvent === "sources") {
            try { onSources?.(JSON.parse(raw)); } catch { /* ignore malformed */ }
            pendingEvent = "";
            continue;
          }
          onChunk(raw.replace(/\\n/g, "\n").replace(/\\r/g, "\r"));
          pendingEvent = "";
        } else if (line === "") {
          pendingEvent = "";
        }
      }
    }
    onDone();
  }).catch((err) => {
    if (err.name !== "AbortError") onError("Lost connection to server.");
  });

  return () => controller.abort();
}
