import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useRepoStore } from "../store/useRepoStore";
import { ingestRepo } from "../api";
import { useIngestionProgress } from "../hooks/useIngestionProgress";
import { EXAMPLES } from "../constants";
import styles from "./LandingPage.module.css";

export default function LandingPage() {
  const navigate = useNavigate();
  const { setIngesting, setReady, setError, status, error } = useRepoStore();
  const [url, setUrl] = useState("");
  const isLoading = status === "ingesting";
  const progress = useIngestionProgress(isLoading);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setIngesting();
    try {
      const { repoId, metadata } = await ingestRepo(url.trim());
      setReady(repoId, metadata);
      navigate(`/repo/${repoId}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Ingestion failed");
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        <div className={styles.logo}>
          <span className={styles.logoIcon}>&lt;/&gt;</span>
          <span className={styles.logoText}>RepoGrok</span>
        </div>

        <p className={styles.tagline}>
          Understand any codebase in minutes.<br />
          Paste a GitHub URL and start exploring.
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
            {isLoading ? "Indexing…" : "Explore →"}
          </button>
        </form>

        {progress > 0 && (
          <div className={styles.progressTrack}>
            <div className={styles.progressFill} style={{ width: `${progress}%` }} />
          </div>
        )}

        {isLoading && (
          <p className={styles.hint}>
            Fetching files · parsing AST · generating embeddings — usually 30s–2 min
          </p>
        )}
        {status === "error" && error && <p className={styles.errorMsg}>{error}</p>}
      </div>

      <div className={styles.examples}>
        <p className={styles.examplesLabel}>Try these repos</p>
        <div className={styles.chips}>
          {EXAMPLES.map((ex) => (
            <button
              key={ex.repo}
              className={styles.chip}
              disabled={isLoading}
              onClick={() => setUrl(`https://github.com/${ex.owner}/${ex.repo}`)}
            >
              <span className={styles.chipIcon}>&lt;/&gt;</span>
              {ex.repo}
            </button>
          ))}
        </div>
      </div>

      <footer className={styles.footer}>
        <span>Built by <a href="https://rajatgupta.site/" target="_blank" rel="noreferrer">Rajat Gupta</a></span>
        <span className={styles.footerDot}>·</span>
        <a href="https://github.com/rajatetc" target="_blank" rel="noreferrer">GitHub</a>
        <span className={styles.footerDot}>·</span>
        <a href="https://linkedin.com/in/rajatetc" target="_blank" rel="noreferrer">LinkedIn</a>
        <span className={styles.footerDot}>·</span>
        <a href="https://x.com/rajatetc" target="_blank" rel="noreferrer">X</a>
      </footer>
    </div>
  );
}
