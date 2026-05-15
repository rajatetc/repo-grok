import { useEffect, useRef, useState, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useRepoStore } from "../store/useRepoStore";
import { streamQuery } from "../api";
import styles from "./ChatTab.module.css";

interface Props {
  repoId: string;
}

const SUGGESTIONS = [
  "What are the main exports and how do they connect?",
  "Walk me through the core flow",
  "What patterns and abstractions does this use?",
];

// Top-K shown to user. Fewer chips = less noise. The model gets all 8 from
// the server; we just don't surface them all in the UI.
const MAX_VISIBLE_SOURCES = 3;

export default function ChatTab({ repoId }: Props) {
  const { messages, addMessage, appendToLastMessage, setSourcesOnLastMessage, metadata } = useRepoStore();
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  const lastUserMsgIdRef = useRef<string | null>(null);

  // On a new user message, anchor it at the top of the chat scroll area so
  // the answer streams into the visible space below it (ChatGPT-style).
  // Skip the constant scroll-during-streaming that pinned the viewport to
  // the bottom and made long answers unreadable.
  useEffect(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== "user") continue;
      if (m.id !== lastUserMsgIdRef.current) {
        lastUserMsgIdRef.current = m.id;
        document.getElementById(`msg-${m.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      break;
    }
  }, [messages]);

  useEffect(() => () => { cleanupRef.current?.(); }, []);

  function handleStop() {
    cleanupRef.current?.();
    cleanupRef.current = null;
    appendToLastMessage("\n\n_Stopped._");
    setStreaming(false);
  }

  function submitQuery(query: string) {
    if (!query || streaming) return;
    const history = messages
      .filter((m) => m.content.trim().length > 0)
      .slice(-10)
      .map((m) => ({ role: m.role, content: m.content }));

    setInput("");
    setStreaming(true);
    addMessage({ id: crypto.randomUUID(), role: "user", content: query });
    addMessage({ id: crypto.randomUUID(), role: "assistant", content: "" });

    cleanupRef.current = streamQuery(
      repoId,
      query,
      history,
      (chunk) => appendToLastMessage(chunk),
      () => setStreaming(false),
      (err) => {
        appendToLastMessage(`\n\n_${err}_`);
        setSourcesOnLastMessage([]); // drop any sources attached before the error fired
        setStreaming(false);
      },
      (sources) => setSourcesOnLastMessage(sources),
    );
  }

  function blobUrl(filePath: string): string {
    if (!metadata) return "#";
    const { owner, repo, branch } = metadata;
    return `https://github.com/${owner}/${repo}/blob/${branch}/${filePath}`;
  }

  // Show the last two segments of the path so files with the same basename
  // (a `server.js` under tests/ vs examples/) stay distinguishable as chips.
  function shortPath(filePath: string): string {
    return filePath.split("/").slice(-2).join("/");
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const query = input.trim();
    submitQuery(query);
  }

  return (
    <div className={styles.container}>
      <div className={styles.messages}>
        {messages.length === 0 && (
          <div className={styles.empty}>
            <p>Ask anything about this codebase.</p>
            <div className={styles.suggestionChips}>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  className={styles.suggestionChip}
                  onClick={() => submitQuery(s)}
                  disabled={streaming}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={msg.id}
            id={`msg-${msg.id}`}
            className={`${styles.row} ${msg.role === "user" ? styles.rowUser : styles.rowAssistant}`}
          >
            {msg.role === "user" ? (
              <div className={styles.userBubble}>{msg.content}</div>
            ) : (
              <div className={styles.assistantMsg}>
                <div className={styles.markdown}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                </div>
                {streaming && i === messages.length - 1 && <span className={styles.cursor} />}
                {msg.sources && msg.sources.length > 0 && !(streaming && i === messages.length - 1) && (
                  <div className={styles.sources}>
                    <span className={styles.sourcesLabel}>Related</span>
                    {msg.sources.slice(0, MAX_VISIBLE_SOURCES).map((s) => (
                      <a
                        key={s.filePath}
                        href={blobUrl(s.filePath)}
                        target="_blank"
                        rel="noreferrer"
                        className={styles.sourceChip}
                        title={s.filePath}
                      >
                        {shortPath(s.filePath)}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <form className={styles.form} onSubmit={handleSubmit}>
        <input
          className={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask anything about this repo…"
          disabled={streaming}
        />
        {streaming ? (
          <button
            className={styles.button}
            type="button"
            onClick={handleStop}
            title="Stop"
            aria-label="Stop generating"
          >■</button>
        ) : (
          <button className={styles.button} type="submit" disabled={!input.trim()}>↑</button>
        )}
      </form>
    </div>
  );
}
