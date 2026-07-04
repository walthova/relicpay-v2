import { useState, useRef, useEffect } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const STARTER_QUESTIONS = [
  "How does yield work?",
  "What happens if I miss a payment?",
  "What are the discount tiers?",
  "How does the escrow protect my funds?",
];

export function ClaudeGuide() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "Hey — I'm your Relic Pay guide. Ask me anything about how this works: the smart contract, yield mechanics, escrow safety, or what happens step by step when you make a purchase.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async (text: string) => {
    if (!text.trim() || loading) return;

    const userMsg: Message = { role: "user", content: text };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const data = await res.json();
      setMessages([...next, { role: "assistant", content: data.text || "Sorry, something went wrong." }]);
    } catch {
      setMessages([...next, { role: "assistant", content: "Connection error — check your API key in .env.local." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.dot} />
        <span style={styles.headerText}>Claude — Relic Pay Guide</span>
      </div>

      <div style={styles.messages}>
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              ...styles.bubble,
              ...(m.role === "user" ? styles.userBubble : styles.assistantBubble),
            }}
          >
            {m.content}
          </div>
        ))}
        {loading && (
          <div style={{ ...styles.bubble, ...styles.assistantBubble, opacity: 0.6 }}>
            Thinking...
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div style={styles.starters}>
        {STARTER_QUESTIONS.map((q) => (
          <button key={q} style={styles.starterBtn} onClick={() => send(q)}>
            {q}
          </button>
        ))}
      </div>

      <div style={styles.inputRow}>
        <input
          style={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send(input)}
          placeholder="Ask anything about Relic Pay..."
          disabled={loading}
        />
        <button
          style={{ ...styles.sendBtn, opacity: loading ? 0.5 : 1 }}
          onClick={() => send(input)}
          disabled={loading}
        >
          Send
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    background: "rgba(15, 23, 42, 0.95)",
    border: "1px solid rgba(99, 102, 241, 0.35)",
    borderRadius: 16,
    overflow: "hidden",
    width: "100%",
    maxWidth: 480,
    height: 520,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "12px 16px",
    borderBottom: "1px solid rgba(99, 102, 241, 0.2)",
    background: "rgba(99, 102, 241, 0.08)",
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "#22d3ee",
    boxShadow: "0 0 6px #22d3ee",
  },
  headerText: {
    fontSize: 13,
    fontWeight: 600,
    color: "#a5b4fc",
    letterSpacing: "0.02em",
  },
  messages: {
    flex: 1,
    overflowY: "auto",
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  bubble: {
    padding: "10px 14px",
    borderRadius: 12,
    fontSize: 13.5,
    lineHeight: 1.55,
    maxWidth: "88%",
    wordBreak: "break-word",
  },
  assistantBubble: {
    background: "rgba(99, 102, 241, 0.12)",
    border: "1px solid rgba(99, 102, 241, 0.2)",
    color: "#e2e8f0",
    alignSelf: "flex-start",
  },
  userBubble: {
    background: "rgba(34, 211, 238, 0.1)",
    border: "1px solid rgba(34, 211, 238, 0.2)",
    color: "#e2e8f0",
    alignSelf: "flex-end",
  },
  starters: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    padding: "8px 16px",
    borderTop: "1px solid rgba(99, 102, 241, 0.15)",
  },
  starterBtn: {
    background: "rgba(99, 102, 241, 0.12)",
    border: "1px solid rgba(99, 102, 241, 0.25)",
    borderRadius: 20,
    padding: "5px 12px",
    fontSize: 11.5,
    color: "#a5b4fc",
    cursor: "pointer",
    transition: "all 0.15s",
  },
  inputRow: {
    display: "flex",
    gap: 8,
    padding: "12px 16px",
    borderTop: "1px solid rgba(99, 102, 241, 0.2)",
  },
  input: {
    flex: 1,
    background: "rgba(30, 27, 75, 0.6)",
    border: "1px solid rgba(99, 102, 241, 0.3)",
    borderRadius: 8,
    padding: "8px 12px",
    color: "#e2e8f0",
    fontSize: 13,
    outline: "none",
  },
  sendBtn: {
    background: "linear-gradient(135deg, #6366f1, #4f46e5)",
    border: "none",
    borderRadius: 8,
    padding: "8px 16px",
    color: "white",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
};
