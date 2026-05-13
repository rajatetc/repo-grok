import { useState, type FormEvent } from "react";
import { getChangeGuide } from "../api";
import type { ChangeGuideResult } from "../types";
import styles from "./ChangeGuideTab.module.css";

interface Props { repoId: string }

export default function ChangeGuideTab({ repoId }: Props) {
  const [description, setDescription] = useState("");
  const [result, setResult] = useState<ChangeGuideResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!description.trim() || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await getChangeGuide(repoId, description.trim());
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate guide");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.inner}>
        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.label}>Describe the change you want to make</label>
          <textarea
            className={styles.textarea}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Add support for optimistic updates in the store…"
            rows={4}
            disabled={loading}
          />
          <button className={styles.button} type="submit" disabled={loading || !description.trim()}>
            {loading ? "Generating…" : "Get Guide"}
          </button>
        </form>

        {error && <p className={styles.error}>{error}</p>}

        {result && (
          <div className={styles.result}>
            <p className={styles.summary}>{result.summary}</p>
            <div className={styles.files}>
              {result.filesToModify.map((f, i) => (
                <div key={i} className={styles.fileCard}>
                  <div className={styles.filePath}>{f.filePath}</div>
                  <p className={styles.reason}>{f.reason}</p>
                  <p className={styles.suggestion}>{f.suggestion}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
