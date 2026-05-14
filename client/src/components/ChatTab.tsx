import { useEffect, useRef, useState, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useRepoStore } from "../store/useRepoStore";
import { streamQuery } from "../api";
import styles from "./ChatTab.module.css";

interface Props {
  repoId: string;
  onOpenKeyModal: () => void;
}

function isRateLimitError(msg: string) {
  const lower = msg.toLowerCase();
  return lower.includes("rate limit") || lower.includes("quota");
}

export default function ChatTab({ repoId, onOpenKeyModal }: Props) {
  const { messages, addMessage, appendToLastMessage, geminiKey } = useRepoStore();
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [showKeyNudge, setShowKeyNudge] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => () => { cleanupRef.current?.(); }, []);

  // Dismiss the nudge once the user actually sets a key
  useEffect(() => {
    if (geminiKey) setShowKeyNudge(false);
  }, [geminiKey]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const query = input.trim();
    if (!query || streaming) return;

    setInput("");
    setStreaming(true);
    addMessage({ id: crypto.randomUUID(), role: "user", content: query });
    addMessage({ id: crypto.randomUUID(), role: "assistant", content: "" });

    cleanupRef.current = streamQuery(
      repoId,
      query,
      (chunk) => appendToLastMessage(chunk),
      () => setStreaming(false),
      (err) => {
        appendToLastMessage(`\n\n_${err}_`);
        setStreaming(false);
        if (isRateLimitError(err) && !geminiKey) setShowKeyNudge(true);
      }
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.messages}>
        {messages.length === 0 && (
          <div className={styles.empty}>
            <p>Ask anything about this codebase.</p>
            <p className={styles.suggestions}>
              "How does the main logic work?" · "What patterns are used?" · "How is error handling done?"
            </p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={msg.id} className={`${styles.row} ${msg.role === "user" ? styles.rowUser : styles.rowAssistant}`}>
            {msg.role === "user" ? (
              <div className={styles.userBubble}>{msg.content}</div>
            ) : (
              <div className={styles.assistantMsg}>
                <div className={styles.markdown}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                </div>
                {streaming && i === messages.length - 1 && <span className={styles.cursor} />}
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {showKeyNudge && (
        <div className={styles.keyNudge}>
          <span>Hitting Gemini's free quota? Bring your own key and keep going.</span>
          <button className={styles.keyNudgeBtn} onClick={onOpenKeyModal}>Add key →</button>
          <button className={styles.keyNudgeDismiss} onClick={() => setShowKeyNudge(false)}>✕</button>
        </div>
      )}

      <form className={styles.form} onSubmit={handleSubmit}>
        <input
          className={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask anything about this repo…"
          disabled={streaming}
        />
        <button className={styles.button} type="submit" disabled={streaming || !input.trim()}>
          {streaming ? "…" : "↑"}
        </button>
      </form>
    </div>
  );
}
