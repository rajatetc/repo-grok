import { useState, useCallback } from "react";
import type { IngestProgress } from "../api";

type State = { percent: number; message: string };

export function useIngestionProgress() {
  const [state, setState] = useState<State>({ percent: 0, message: "" });

  const onProgress = useCallback((p: IngestProgress) => {
    if (p.stage === "fetch") {
      setState({ percent: 15, message: "Fetching repository…" });
    } else if (p.stage === "chunk") {
      setState({ percent: 30, message: `Parsed ${p.total.toLocaleString()} chunks…` });
    } else if (p.stage === "embed") {
      const pct = 30 + Math.round((p.done / p.total) * 60);
      setState({ percent: pct, message: `Embedding ${p.done.toLocaleString()} / ${p.total.toLocaleString()}…` });
    }
  }, []);

  const onDone = useCallback(() => setState({ percent: 100, message: "Done!" }), []);
  const reset = useCallback(() => setState({ percent: 0, message: "" }), []);

  return { ...state, onProgress, onDone, reset };
}
