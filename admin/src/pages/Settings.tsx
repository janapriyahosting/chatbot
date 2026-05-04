import { useEffect, useState } from "react";
import { Layout } from "../Layout";
import { api } from "../api";
import { useAuth } from "../store";

type Day = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
const DAYS: Day[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABEL: Record<Day, string> = {
  mon: "Monday", tue: "Tuesday", wed: "Wednesday",
  thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday",
};

type DaySchedule = { start: string; end: string };
type Schedule = Partial<Record<Day, DaySchedule>>;

export function Settings() {
  const role = useAuth((s) => s.user?.role);
  const canEdit = role === "admin";

  const [schedule, setSchedule] = useState<Schedule>({});
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.getWorkingHours()
      .then((r) => { setSchedule(r.schedule || {}); setLoaded(true); })
      .catch((e) => setErr(e.message));
  }, []);

  const setDay = (d: Day, val: DaySchedule | null) => {
    setSchedule((s) => {
      const next = { ...s };
      if (val) next[d] = val; else delete next[d];
      return next;
    });
  };

  const save = async () => {
    setBusy(true); setMsg(null); setErr(null);
    try {
      await api.putWorkingHours(schedule);
      setMsg("Saved.");
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const applyWeekdays = () => {
    const next: Schedule = { ...schedule };
    (["mon", "tue", "wed", "thu", "fri"] as Day[]).forEach((d) => {
      next[d] = { start: "09:00", end: "18:00" };
    });
    delete next.sat; delete next.sun;
    setSchedule(next);
  };

  const clearAll = () => setSchedule({});

  return (
    <Layout>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Office working hours</h2>
        <div style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
          When the current time (Asia/Kolkata) is outside this window, no chat
          is auto-assigned. Visitors hitting the handoff node see the
          out-of-hours message configured on that node and the chat queues for
          the next agent online.
        </div>
      </div>
      {err && <div className="error" style={{ marginBottom: 12 }}>{err}</div>}
      {msg && <div style={{ background: "#d1fae5", color: "#065f46", padding: "8px 12px", borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{msg}</div>}

      {!loaded ? (
        <div style={{ color: "#6b7280" }}>Loading…</div>
      ) : (
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: 16 }}>
          {DAYS.map((d) => {
            const v = schedule[d];
            const on = !!v;
            return (
              <div key={d} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "1px solid #f3f4f6" }}>
                <label style={{ width: 130, fontSize: 14 }}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!canEdit}
                    onChange={(e) => setDay(d, e.target.checked ? { start: "09:00", end: "18:00" } : null)}
                  />{" "}
                  {DAY_LABEL[d]}
                </label>
                {on ? (
                  <>
                    <input
                      type="time"
                      value={v!.start}
                      disabled={!canEdit}
                      onChange={(e) => setDay(d, { ...v!, start: e.target.value })}
                      style={{ width: 130 }}
                    />
                    <span style={{ color: "#6b7280" }}>to</span>
                    <input
                      type="time"
                      value={v!.end}
                      disabled={!canEdit}
                      onChange={(e) => setDay(d, { ...v!, end: e.target.value })}
                      style={{ width: 130 }}
                    />
                  </>
                ) : (
                  <span style={{ color: "#9ca3af", fontSize: 13 }}>closed</span>
                )}
              </div>
            );
          })}
          {canEdit && (
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="btn ghost" onClick={applyWeekdays} disabled={busy}>
                Mon–Fri 9–18
              </button>
              <button className="btn ghost" onClick={clearAll} disabled={busy}>
                Always open (clear)
              </button>
              <div style={{ flex: 1 }} />
              <button className="btn" onClick={save} disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          )}
        </div>
      )}
    </Layout>
  );
}
