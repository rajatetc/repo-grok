import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRepoStore } from "../store/useRepoStore";
import { streamQuery } from "../api";
import styles from "./ChatTab.module.css";

interface Props { repoId: string }

export default function ChatTab({ repoId }: Props) {
  const { messages, addMessage, appendToLastMessage } = useRepoStore();
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Cancel stream on unmount
  useEffect(() => () => { cleanupRef.current?.(); }, []);

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
        appendToLastMessage(`\n\n[Error: ${err}]`);
        setStreaming(false);
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
              Try: "How does the main logic work?" · "What patterns are used?" · "How is error handling done?"
            </p>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`${styles.message} ${styles[msg.role]}`}>
            <span className={styles.roleLabel}>{msg.role === "user" ? "You" : "Assistant"}</span>
            <p className={styles.content}>{msg.content}{msg.role === "assistant" && streaming && msg === messages[messages.length - 1] && <span className={styles.cursor} />}</p>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form className={styles.form} onSubmit={handleSubmit}>
        <input
          className={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question about this repo…"
          disabled={streaming}
        />
        <button className={styles.button} type="submit" disabled={streaming || !input.trim()}>
          {streaming ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}
