import { useState } from "react";

const GROUPS = [
  { name: "Smileys", emojis: "😀 😃 😄 😁 😆 😊 😉 😍 😘 🤔 🙂 🙃 😎 🥳 🤗 😇".split(" ") },
  { name: "Gestures", emojis: "👍 👎 👌 🙌 👏 🙏 💪 👋 🤝 ✌️ 👉 👆 ✋".split(" ") },
  { name: "Hearts", emojis: "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 💯".split(" ") },
  { name: "Objects", emojis: "🏠 🏡 🏢 🏘️ 🛋️ 🛌 🔑 💼 💰 📞 📱 💻 📧 📅 🎁".split(" ") },
  { name: "Nature", emojis: "☀️ ⛅ 🌧️ ❄️ 🌸 🌿 🌳 🌻 🔥 ✨ ⭐".split(" ") },
];

export function EmojiPicker({ onInsert }: { onInsert: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative", display: "inline-block", marginLeft: 6 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          background: "#fffbeb", color: "#92400e", border: "1px solid #fde68a",
          borderRadius: 4, fontSize: 11, padding: "2px 6px", cursor: "pointer", marginTop: 4,
        }}
      >
        + emoji
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 0, zIndex: 10,
          background: "#fff", border: "1px solid #e5e7eb", borderRadius: 6,
          boxShadow: "0 6px 16px rgba(0,0,0,.1)", padding: 8, width: 260,
          maxHeight: 260, overflowY: "auto",
        }}>
          {GROUPS.map((g) => (
            <div key={g.name}>
              <div style={{ fontSize: 10, textTransform: "uppercase", color: "#9ca3af", margin: "4px 0" }}>
                {g.name}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {g.emojis.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => { onInsert(e); setOpen(false); }}
                    style={{
                      border: "none", background: "transparent", fontSize: 20, cursor: "pointer",
                      padding: 2, borderRadius: 4,
                    }}
                    onMouseEnter={(ev) => (ev.currentTarget.style.background = "#f3f4f6")}
                    onMouseLeave={(ev) => (ev.currentTarget.style.background = "")}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
