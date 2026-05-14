import { create } from "zustand";
import type { RepoMetadata, ChatMessage } from "../types";

type Status = "idle" | "ingesting" | "ready" | "error";

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

  addMessage: (message: ChatMessage) => void;
  appendToLastMessage: (text: string) => void;
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

  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  appendToLastMessage: (text) =>
    set((state) => {
      const messages = [...state.messages];
      const last = messages[messages.length - 1];
      if (last?.role === "assistant") {
        messages[messages.length - 1] = { ...last, content: last.content + text };
      }
      return { messages };
    }),
}));
