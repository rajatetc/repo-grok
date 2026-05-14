import { useState, useRef, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useRepoStore } from "../store/useRepoStore";
import { ingestRepoStream } from "../api";
import { useIngestionProgress } from "../hooks/useIngestionProgress";
import { useTheme } from "../hooks/useTheme";
import { EXAMPLES } from "../constants";
import styles from "./LandingPage.module.css";

export default function LandingPage() {
  const navigate = useNavigate();
  const { setIngesting, setReady, setError, status, error } = useRepoStore();
  const { theme, toggle } = useTheme();
  const [url, setUrl] = useState("");
  const isLoading = status === "ingesting";
  const { percent, message, onProgress, onDone, reset } = useIngestionProgress();
  const cleanupRef = useRef<(() => void) | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!url.trim() || isLoading) return;
    setIngesting();
    reset();

    cleanupRef.current = ingestRepoStream(
      url.trim(),
      onProgress,
      (repoId, metadata) => {
        onDone();
        setReady(repoId, metadata);
        setTimeout(() => navigate(`/repo/${repoId}`), 300);
      },
      (err) => setError(err)
    );
  }

  return (
    <div className={styles.page}>
      <button className={styles.themeBtn} onClick={toggle} title="Toggle theme">
        {theme === "dark" ? "☀" : "☾"}
      </button>

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

        {percent > 0 && (
          <div className={styles.progressTrack}>
            <div className={styles.progressFill} style={{ width: `${percent}%` }} />
          </div>
        )}

        <p className={styles.langNote}>JavaScript &amp; TypeScript · Python, Go, Rust coming soon</p>

        {isLoading && message && <p className={styles.hint}>{message}</p>}
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
