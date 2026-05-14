import { useState, useCallback } from "react";
import type { IngestProgress } from "../api";

export type IngestionStage = "idle" | "fetch" | "chunk" | "embed" | "done";

export type IngestionState = { percent: number; stage: IngestionStage };

export const IDLE_STATE: IngestionState = { percent: 0, stage: "idle" };
export const DONE_STATE: IngestionState = { percent: 100, stage: "done" };

// Pure mapping from a server progress event to UI state — extracted so it
// can be unit-tested without rendering.
export function nextProgressState(p: IngestProgress): IngestionState {
  if (p.stage === "fetch") return { percent: 15, stage: "fetch" };
  if (p.stage === "chunk") return { percent: 30, stage: "chunk" };
  const pct = 30 + Math.round((p.done / p.total) * 60);
  return { percent: pct, stage: "embed" };
}

export function useIngestionProgress() {
  const [state, setState] = useState<IngestionState>(IDLE_STATE);

  const onProgress = useCallback((p: IngestProgress) => setState(nextProgressState(p)), []);
  const onDone = useCallback(() => setState(DONE_STATE), []);
  const reset = useCallback(() => setState(IDLE_STATE), []);

  return { ...state, onProgress, onDone, reset };
}
