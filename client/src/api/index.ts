import axios from "axios";
import type { RepoMetadata, ChangeGuideResult } from "../types";
import { API_BASE } from "../constants";

const client = axios.create({ baseURL: API_BASE });

// Extract a human-readable message from any thrown error.
// Prefers the server's own `{ error: "..." }` body, falls back to
// status-based messages, then network/unknown messages.
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

export async function ingestRepo(url: string): Promise<{ repoId: string; metadata: RepoMetadata }> {
  try {
    const { data } = await client.post("/api/repos", { url });
    return data;
  } catch (err) {
    throw new Error(extractError(err));
  }
}

export async function getOverview(repoId: string): Promise<RepoMetadata> {
  try {
    const { data } = await client.get(`/api/repos/${repoId}/overview`);
    return data;
  } catch (err) {
    throw new Error(extractError(err));
  }
}

export async function getChangeGuide(repoId: string, description: string): Promise<ChangeGuideResult> {
  try {
    const { data } = await client.post(`/api/repos/${repoId}/change-guide`, { description });
    return data;
  } catch (err) {
    throw new Error(extractError(err));
  }
}

// Returns a cleanup function — call it to close the SSE connection.
export function streamQuery(
  repoId: string,
  query: string,
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (msg: string) => void
): () => void {
  const controller = new AbortController();

  fetch(`${API_BASE}/api/repos/${repoId}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    signal: controller.signal,
  }).then(async (res) => {
    if (!res.ok || !res.body) {
      onError("Query failed — please try again.");
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
        if (line.startsWith("event: done")) { onDone(); return; }
        if (line.startsWith("event: error")) { onError("Stream error from server."); return; }
        if (line.startsWith("data: ")) {
          const raw = line.slice(6);
          onChunk(raw.replace(/\\n/g, "\n").replace(/\\r/g, "\r"));
        }
      }
    }
    onDone();
  }).catch((err) => {
    if (err.name !== "AbortError") onError("Lost connection to server.");
  });

  return () => controller.abort();
}
