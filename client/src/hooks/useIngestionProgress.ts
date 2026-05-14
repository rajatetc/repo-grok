import { useState, useCallback } from "react";
import type { IngestProgress } from "../api";

export type IngestionStage = "idle" | "fetch" | "chunk" | "embed" | "done";

type State = { percent: number; message: string; stage: IngestionStage };

export function useIngestionProgress() {
  const [state, setState] = useState<State>({ percent: 0, message: "", stage: "idle" });

  const onProgress = useCallback((p: IngestProgress) => {
    if (p.stage === "fetch") {
      setState({ percent: 15, message: "Fetching repository…", stage: "fetch" });
    } else if (p.stage === "chunk") {
      setState({ percent: 30, message: `Parsed ${p.total.toLocaleString()} chunks…`, stage: "chunk" });
    } else if (p.stage === "embed") {
      const pct = 30 + Math.round((p.done / p.total) * 60);
      setState({ percent: pct, message: `Embedding ${p.done.toLocaleString()} / ${p.total.toLocaleString()} chunks…`, stage: "embed" });
    }
  }, []);

  const onDone = useCallback(() => setState({ percent: 100, message: "Done!", stage: "done" }), []);
  const reset = useCallback(() => setState({ percent: 0, message: "", stage: "idle" }), []);

  return { ...state, onProgress, onDone, reset };
}
