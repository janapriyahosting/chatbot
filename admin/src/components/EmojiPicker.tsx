import { useEffect, useRef, useState } from "react";

const EMOJIS = [
  "😀", "😄", "😅", "😂", "😍", "😊", "😎", "🤔",
  "😐", "😢", "😭", "😡", "👍", "👎", "👌", "🙏",
  "🙌", "👋", "💪", "🎉", "❤️", "💔", "✅", "❌",
  "❓", "❗", "⏳", "📅", "📞", "📍", "🏠", "🏢",
  "🚀", "✨", "🔔", "📝", "💬", "🤝", "☎️", "📷",
];

export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        className="btn ghost"
        onClick={() => setOpen((v) => !v)}
        title="Insert emoji"
        style={{ padding: "6px 10px", fontSize: 18, lineHeight: 1 }}
      >
        😊
      </button>
      {open && (
        <div
          style={{
            position: "absolute", bottom: "calc(100% + 6px)", left: 0,
            background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8,
            padding: 6, boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
            display: "grid", gridTemplateColumns: "repeat(8, 28px)", gap: 2, zIndex: 50,
          }}
        >
          {EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => { onPick(e); setOpen(false); }}
              style={{
                width: 28, height: 28, padding: 0, border: "none",
                background: "transparent", cursor: "pointer", fontSize: 18, lineHeight: 1,
                borderRadius: 4,
              }}
              onMouseEnter={(ev) => (ev.currentTarget.style.background = "#f3f4f6")}
              onMouseLeave={(ev) => (ev.currentTarget.style.background = "transparent")}
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
