import { create } from "zustand";
import type { RepoMetadata, ChatMessage, Source } from "../types";

type Status = "idle" | "ingesting" | "ready" | "error";

const MAX_MESSAGES = 50;

interface RepoStore {
  repoId: string | null;
  metadata: RepoMetadata | null;
  status: Status;
  error: string | null;
  messages: ChatMessage[];
  chunkWarning: string | null;

  setIngesting: () => void;
  setReady: (repoId: string, metadata: RepoMetadata) => void;
  setError: (error: string) => void;
  setChunkWarning: (msg: string | null) => void;
  cancelIngest: () => void;

  addMessage: (message: ChatMessage) => void;
  appendToLastMessage: (text: string) => void;
  setSourcesOnLastMessage: (sources: Source[]) => void;
}

export const useRepoStore = create<RepoStore>((set) => ({
  repoId: null,
  metadata: null,
  status: "idle",
  error: null,
  messages: [],
  chunkWarning: null,

  setIngesting: () => set({ status: "ingesting", error: null, chunkWarning: null }),
  setReady: (repoId, metadata) =>
    set((state) => ({
      repoId,
      metadata,
      status: "ready",
      error: null,
      messages: state.repoId !== repoId ? [] : state.messages,
    })),
  setError: (error) => set({ status: "error", error }),
  setChunkWarning: (msg) => set({ chunkWarning: msg }),
  cancelIngest: () => set({ status: "idle", error: null, chunkWarning: null }),

  addMessage: (message) => set((state) => {
    const msgs = [...state.messages, message];
    return { messages: msgs.length > MAX_MESSAGES ? msgs.slice(msgs.length - MAX_MESSAGES) : msgs };
  }),
  appendToLastMessage: (text) =>
    set((state) => {
      const messages = [...state.messages];
      const last = messages[messages.length - 1];
      if (last?.role === "assistant") {
        messages[messages.length - 1] = { ...last, content: last.content + text };
      }
      return { messages };
    }),

  setSourcesOnLastMessage: (sources) =>
    set((state) => {
      const messages = [...state.messages];
      const last = messages[messages.length - 1];
      if (last?.role === "assistant") {
        messages[messages.length - 1] = { ...last, sources };
      }
      return { messages };
    }),
}));
