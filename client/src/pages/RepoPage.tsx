import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useRepoStore } from "../store/useRepoStore";
import { getOverview } from "../api";
import { useTheme } from "../hooks/useTheme";
import OverviewTab from "../components/OverviewTab";
import PulseTab from "../components/PulseTab";
import ChatTab from "../components/ChatTab";
import styles from "./RepoPage.module.css";

export default function RepoPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { metadata, setReady, reset, geminiKey, setGeminiKey } = useRepoStore();
  const { theme, toggle } = useTheme();
  const [loading, setLoading]           = useState(false);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [keyInput, setKeyInput]         = useState("");
  const [activeTab, setActiveTab]       = useState<"overview" | "pulse">("overview");

  useEffect(() => {
    if (!id) return;
    if (!metadata || metadata.id !== id) setLoading(true);
    getOverview(id)
      .then((data) => setReady(id, data))
      .catch(() => { reset(); navigate("/"); })
      .finally(() => setLoading(false));
  }, [id]);

  function openKeyModal() { setKeyInput(geminiKey ?? ""); setShowKeyModal(true); }
  function saveKey()      { setGeminiKey(keyInput.trim() || null); setShowKeyModal(false); }
  function removeKey()    { setGeminiKey(null); setKeyInput(""); setShowKeyModal(false); }

  if (loading || !metadata || metadata.id !== id) {
    return <div className={styles.center}><p className={styles.loadingText}>Loading…</p></div>;
  }

  return (
    <div className={styles.page}>

      {/* ── Nav ─────────────────────────────── */}
      <nav className={styles.nav}>
        <div className={styles.navLeft}>
          <button className={styles.iconBtn} onClick={() => navigate("/")} title="Back">←</button>
          <span className={styles.repoSlug}>
            <span className={styles.owner}>{metadata.owner}/</span>{metadata.repo}
          </span>
        </div>
        <div className={styles.navRight}>
          <button className={styles.iconBtn} onClick={toggle} title="Toggle theme">
            {theme === "dark" ? "☀" : "☾"}
          </button>
          <button
            className={`${styles.keyBtn} ${geminiKey ? styles.keyBtnActive : ""}`}
            onClick={openKeyModal}
          >
            {geminiKey ? "Key set ✓" : "API Key"}
          </button>
        </div>
      </nav>

      {/* ── Body ────────────────────────────── */}
      <div className={styles.body}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarTabs}>
            <button
              className={`${styles.sidebarTab} ${activeTab === "overview" ? styles.sidebarTabActive : ""}`}
              onClick={() => setActiveTab("overview")}
            >Overview</button>
            <button
              className={`${styles.sidebarTab} ${activeTab === "pulse" ? styles.sidebarTabActive : ""}`}
              onClick={() => setActiveTab("pulse")}
            >Pulse</button>
          </div>
          <div className={styles.sidebarContent}>
            <div hidden={activeTab !== "overview"}><OverviewTab metadata={metadata} /></div>
            <div hidden={activeTab !== "pulse"}><PulseTab owner={metadata.owner} repo={metadata.repo} /></div>
          </div>
        </aside>
        <main className={styles.chatArea}>
          <ChatTab repoId={metadata.id} onOpenKeyModal={openKeyModal} />
        </main>
      </div>

      {/* ── Footer ───────────────────────── */}
      <footer className={styles.footer}>
        <span>Built by <a href="https://rajatgupta.site/" target="_blank" rel="noreferrer">Rajat Gupta</a></span>
        <span className={styles.footerDot}>·</span>
        <a href="https://github.com/rajatetc" target="_blank" rel="noreferrer">GitHub</a>
        <span className={styles.footerDot}>·</span>
        <a href="https://linkedin.com/in/rajatetc" target="_blank" rel="noreferrer">LinkedIn</a>
        <span className={styles.footerDot}>·</span>
        <a href="https://x.com/rajatetc" target="_blank" rel="noreferrer">X</a>
      </footer>

      {/* ── API Key modal ─────────────────── */}
      {showKeyModal && (
        <div className={styles.modalBackdrop} onClick={() => setShowKeyModal(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <p className={styles.modalTitle}>Bring your own Gemini key</p>
            <p className={styles.modalHint}>
              Stored in memory only — gone when you close the tab. Never written to disk or sent to our server except as a request header for your own queries.{" "}
              <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className={styles.modalLink}>
                Get a free key →
              </a>
            </p>
            <input
              className={styles.modalInput}
              type="password"
              placeholder="AIza…"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveKey()}
              autoFocus
            />
            <div className={styles.modalActions}>
              <button className={styles.modalSave} onClick={saveKey}>Save</button>
              {geminiKey && <button className={styles.modalClear} onClick={removeKey}>Remove</button>}
              <button className={styles.modalCancel} onClick={() => setShowKeyModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
