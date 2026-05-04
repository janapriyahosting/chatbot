import { useRef, useState } from "react";
import { api } from "../api";

type UploadInfo = {
  url: string;
  filename?: string;
  original_filename?: string;
  size?: number;
  content_type?: string;
};

export function UploadButton({
  accept = "image/*",
  onUploaded,
  label = "Upload",
}: {
  accept?: string;
  onUploaded: (url: string, info?: UploadInfo) => void;
  label?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      const r: any = await api.uploadFile(file);
      onUploaded(r.url, r);
    } catch (ex: any) {
      setErr(ex.message || "upload failed");
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  };

  return (
    <div style={{ display: "inline-block" }}>
      <button
        type="button"
        className="btn ghost"
        style={{ padding: "4px 8px", fontSize: 12, marginTop: 4 }}
        disabled={busy}
        onClick={() => ref.current?.click()}
      >
        {busy ? "Uploading…" : `↑ ${label}`}
      </button>
      <input ref={ref} type="file" accept={accept} style={{ display: "none" }} onChange={onPick} />
      {err && <div className="error">{err}</div>}
    </div>
  );
}
