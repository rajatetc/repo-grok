import type { RepoMetadata, Source } from "../types";
import { API_BASE } from "../constants";

export type IngestProgress =
  | { stage: "fetch" }
  | { stage: "chunk"; total: number }
  | { stage: "embed"; done: number; total: number };

// Returns a cleanup function — call it to abort the stream.
export function ingestRepoStream(
  url: string,
  onProgress: (p: IngestProgress) => void,
  onDone: (repoId: string, metadata: RepoMetadata) => void,
  onError: (msg: string) => void,
  onWarning?: (msg: string) => void
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
          if (pendingEvent === "warning") {
            try { onWarning?.(JSON.parse(raw)); } catch { /* ignore */ }
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


// Returns a cleanup function — call it to close the SSE connection.
export function streamQuery(
  repoId: string,
  query: string,
  history: { role: "user" | "assistant"; content: string }[],
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (msg: string) => void,
  onSources?: (sources: Source[]) => void,
  onDegraded?: () => void,
): () => void {
  const controller = new AbortController();

  fetch(`${API_BASE}/api/repos/${repoId}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
          if (pendingEvent === "degraded") {
            onDegraded?.();
            pendingEvent = "";
            continue;
          }
          onChunk(JSON.parse(raw));
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
