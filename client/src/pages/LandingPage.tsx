import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useRepoStore } from "../store/useRepoStore";
import { ingestRepo } from "../api";
import ExampleCard from "../components/ExampleCard";
import styles from "./LandingPage.module.css";

const EXAMPLES = [
  { owner: "immerjs",   repo: "immer",   desc: "Immutable state with mutable syntax",  time: "~30s"  },
  { owner: "reduxjs",   repo: "redux",   desc: "The classic state manager",             time: "~1 min" },
  { owner: "pmndrs",    repo: "zustand", desc: "Lightweight modern state",              time: "~45s"  },
  { owner: "vercel",    repo: "swr",     desc: "Data fetching and caching hooks",       time: "~45s"  },
  { owner: "axios",     repo: "axios",   desc: "Promise-based HTTP client",             time: "~1 min" },
  { owner: "colinhacks", repo: "zod",    desc: "TypeScript-first schema validation",    time: "~2 min" },
];

export default function LandingPage() {
  const navigate = useNavigate();
  const { setIngesting, setReady, setError, status, error } = useRepoStore();
  const [url, setUrl] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setIngesting();
    try {
      const { repoId, metadata } = await ingestRepo(url.trim());
      setReady(repoId, metadata);
      navigate(`/repo/${repoId}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Ingestion failed";
      setError(msg);
    }
  }

  const isLoading = status === "ingesting";

  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        <h1 className={styles.title}>
          Understand any codebase<br />
          <span className={styles.accent}>in minutes</span>
        </h1>
        <p className={styles.subtitle}>
          Paste a GitHub URL. Get an interactive overview, architecture summary,
          and a chat interface powered by RAG.
        </p>

        <form className={styles.form} onSubmit={handleSubmit}>
          <input
            className={styles.input}
            type="text"
            placeholder="https://github.com/owner/repo"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={isLoading}
            spellCheck={false}
          />
          <button className={styles.button} type="submit" disabled={isLoading}>
            {isLoading ? "Indexing…" : "Explore"}
          </button>
        </form>

        {isLoading && (
          <p className={styles.hint}>
            Fetching files, chunking, and embedding — this takes 30s–2 min depending on repo size.
          </p>
        )}
        {status === "error" && error && (
          <p className={styles.error}>{error}</p>
        )}
      </div>

      <div className={styles.examples}>
        <p className={styles.examplesLabel}>Try an example</p>
        <div className={styles.grid}>
          {EXAMPLES.map((ex) => (
            <ExampleCard
              key={ex.repo}
              {...ex}
              disabled={isLoading}
              onClick={() => setUrl(`https://github.com/${ex.owner}/${ex.repo}`)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
