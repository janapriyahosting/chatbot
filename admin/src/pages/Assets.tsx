import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { Layout } from "../Layout";
import { useAuth } from "../store";

type Kind = "image" | "video" | "document";
type Asset = {
  filename: string;
  url: string;
  kind: Kind | "other";
  extension: string;
  size: number;
  uploaded_at: string;
};

const FILTERS: { id: "all" | Kind; label: string; icon: string }[] = [
  { id: "all", label: "All", icon: "🗂️" },
  { id: "image", label: "Images", icon: "🖼️" },
  { id: "video", label: "Videos", icon: "🎬" },
  { id: "document", label: "Documents", icon: "📄" },
];

export function Assets() {
  const role = useAuth((s) => s.user?.role);
  const canDelete = role === "admin" || role === "supervisor";
  const [assets, setAssets] = useState<Asset[]>([]);
  const [filter, setFilter] = useState<"all" | Kind>("all");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true); setErr(null);
    try { setAssets(await api.listUploads()); }
    catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: assets.length, image: 0, video: 0, document: 0 };
    for (const a of assets) c[a.kind] = (c[a.kind] || 0) + 1;
    return c;
  }, [assets]);

  const filtered = useMemo(
    () => filter === "all" ? assets : assets.filter((a) => a.kind === filter),
    [assets, filter],
  );

  const onCopy = (url: string) => {
    navigator.clipboard.writeText(window.location.origin + url);
  };

  const onDelete = async (a: Asset) => {
    if (!confirm(`Delete ${a.filename}? This cannot be undone.`)) return;
    try {
      await api.deleteUpload(a.filename);
      setAssets((prev) => prev.filter((x) => x.filename !== a.filename));
    } catch (e: any) { setErr(e.message); }
  };

  return (
    <Layout wide>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Assets</h2>
        <div style={{ flex: 1 }} />
        <button className="btn ghost" onClick={load}>Refresh</button>
      </div>
      <p style={{ color: "#6b7280", marginTop: 0 }}>
        Every file uploaded to flow nodes (image, video, document, carousel slides) lives here.
        Filenames are content-addressed, so the same image used in many places shows up once.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            className={"btn " + (filter === f.id ? "" : "ghost")}
            onClick={() => setFilter(f.id)}
          >
            <span style={{ marginRight: 6 }}>{f.icon}</span>
            {f.label}
            <span style={{ marginLeft: 8, opacity: .7, fontSize: 12 }}>
              {counts[f.id] ?? 0}
            </span>
          </button>
        ))}
      </div>

      {err && <div className="error" style={{ marginBottom: 12 }}>{err}</div>}
      {loading && <div className="card">Loading…</div>}
      {!loading && filtered.length === 0 && (
        <div className="card" style={{ textAlign: "center", color: "#6b7280" }}>
          No {filter === "all" ? "uploads" : filter + "s"} yet.
          {filter === "all" && " Upload from any flow node's media field."}
        </div>
      )}

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
        gap: 12,
      }}>
        {filtered.map((a) => (
          <AssetCard key={a.filename} asset={a} onCopy={onCopy} onDelete={canDelete ? onDelete : undefined} />
        ))}
      </div>
    </Layout>
  );
}

function AssetCard({
  asset, onCopy, onDelete,
}: {
  asset: Asset;
  onCopy: (url: string) => void;
  onDelete?: (a: Asset) => void;
}) {
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <div style={{
        height: 140, background: "#f3f4f6", display: "flex",
        alignItems: "center", justifyContent: "center", overflow: "hidden",
      }}>
        {asset.kind === "image" && (
          <img src={asset.url} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "cover" }} />
        )}
        {asset.kind === "video" && (
          <video src={asset.url} preload="metadata" style={{ maxWidth: "100%", maxHeight: "100%" }} />
        )}
        {(asset.kind === "document" || asset.kind === "other") && (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 36 }}>📄</div>
            <div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>
              {asset.extension.replace(".", "") || "file"}
            </div>
          </div>
        )}
      </div>
      <div style={{ padding: 10, fontSize: 12 }}>
        <div style={{
          fontFamily: "ui-monospace, monospace", fontSize: 11,
          color: "#374151", overflow: "hidden", textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }} title={asset.filename}>
          {asset.filename}
        </div>
        <div style={{ display: "flex", color: "#6b7280", marginTop: 2 }}>
          <span>{formatSize(asset.size)}</span>
          <span style={{ flex: 1 }} />
          <span>{formatDate(asset.uploaded_at)}</span>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <button className="btn ghost" style={{ flex: 1, fontSize: 11 }} onClick={() => onCopy(asset.url)}>
            Copy URL
          </button>
          <a className="btn ghost" style={{ fontSize: 11 }} href={asset.url} target="_blank" rel="noopener">
            Open
          </a>
          {onDelete && (
            <button
              className="btn ghost"
              style={{ fontSize: 11, color: "#dc2626" }}
              onClick={() => onDelete(asset)}
              title="Delete"
            >
              ✕
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
  if (diff < 86400 * 7) return Math.floor(diff / 86400) + "d ago";
  return d.toLocaleDateString();
}
