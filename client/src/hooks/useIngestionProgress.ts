import { useState, useEffect, useRef } from "react";

export function useIngestionProgress(isLoading: boolean): number {
  const [progress, setProgress] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    if (!isLoading) {
      if (started.current) {
        started.current = false;
        setProgress(100);
        const t = setTimeout(() => setProgress(0), 600);
        return () => clearTimeout(t);
      }
      return;
    }

    started.current = true;
    setProgress(8);
    const checkpoints: [number, number][] = [
      [3000, 28], [8000, 50], [16000, 68], [30000, 78], [55000, 86], [85000, 92],
    ];
    const timers = checkpoints.map(([d, p]) => setTimeout(() => setProgress(p), d));
    return () => timers.forEach(clearTimeout);
  }, [isLoading]);

  return progress;
}
