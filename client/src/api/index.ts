import axios from "axios";
import type { RepoMetadata, ChangeGuideResult } from "../types";

const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

const client = axios.create({ baseURL: BASE_URL });

export async function ingestRepo(url: string): Promise<{ repoId: string; metadata: RepoMetadata }> {
  const { data } = await client.post("/api/repos", { url });
  return data;
}

export async function getOverview(repoId: string): Promise<RepoMetadata> {
  const { data } = await client.get(`/api/repos/${repoId}/overview`);
  return data;
}

export async function getChangeGuide(repoId: string, description: string): Promise<ChangeGuideResult> {
  const { data } = await client.post(`/api/repos/${repoId}/change-guide`, { description });
  return data;
}

// Returns a cleanup function — call it to close the SSE connection
export function streamQuery(
  repoId: string,
  query: string,
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (msg: string) => void
): () => void {
  // SSE requires GET but our route is POST — use fetch with ReadableStream instead
  const controller = new AbortController();

  fetch(`${BASE_URL}/api/repos/${repoId}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    signal: controller.signal,
  }).then(async (res) => {
    if (!res.ok || !res.body) {
      onError("Request failed");
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("event: done")) {
          onDone();
          return;
        }
        if (line.startsWith("event: error")) {
          onError("Stream error from server");
          return;
        }
        if (line.startsWith("data: ")) {
          const raw = line.slice(6);
          // Unescape the \n and \r the server encodes
          const text = raw.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
          onChunk(text);
        }
      }
    }
    onDone();
  }).catch((err) => {
    if (err.name !== "AbortError") onError(err.message);
  });

  return () => controller.abort();
}
