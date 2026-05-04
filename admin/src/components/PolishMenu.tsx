import { useEffect, useRef, useState } from "react";

const TONES: { key: string; label: string; emoji: string }[] = [
  { key: "friendly",   label: "Friendly",   emoji: "🙂" },
  { key: "formal",     label: "Formal",     emoji: "🎩" },
  { key: "concise",    label: "Concise",    emoji: "✂️" },
  { key: "empathetic", label: "Empathetic", emoji: "💛" },
  { key: "apologetic", label: "Apologetic", emoji: "🙏" },
];

export function PolishMenu({
  disabled, busy, onPolish,
}: {
  disabled: boolean;
  busy: boolean;
  onPolish: (tone: string) => void;
}) {
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
        disabled={disabled || busy}
        onClick={() => !disabled && !busy && setOpen((v) => !v)}
        title="Rewrite with AI"
        style={{ padding: "6px 10px", fontSize: 14, lineHeight: 1 }}
      >
        {busy ? "…" : "✨"}
      </button>
      {open && (
        <div
          style={{
            position: "absolute", bottom: "calc(100% + 6px)", right: 0,
            background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8,
            padding: 4, boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
            display: "flex", flexDirection: "column", minWidth: 180, zIndex: 50,
          }}
        >
          <div style={{ padding: "6px 10px", fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.4 }}>
            Rewrite as…
          </div>
          {TONES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => { setOpen(false); onPolish(t.key); }}
              style={{
                textAlign: "left", padding: "8px 10px", border: "none",
                background: "transparent", cursor: "pointer", fontSize: 13,
                borderRadius: 4, color: "#1f2937", display: "flex", alignItems: "center", gap: 8,
              }}
              onMouseEnter={(ev) => (ev.currentTarget.style.background = "#f3f4f6")}
              onMouseLeave={(ev) => (ev.currentTarget.style.background = "transparent")}
            >
              <span style={{ fontSize: 16 }}>{t.emoji}</span>
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
