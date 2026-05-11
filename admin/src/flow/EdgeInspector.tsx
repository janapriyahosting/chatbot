import type { Edge, Node } from "@xyflow/react";

type FlowNodeData = { label: string; nodeType: string; config: any };

export function EdgeInspector({
  edge, sourceNode, onChange, onDelete,
}: {
  edge: Edge;
  sourceNode: Node | null;
  onChange: (patch: Partial<Edge>) => void;
  onDelete: () => void;
}) {
  const sourceData = sourceNode?.data as FlowNodeData | undefined;
  const sourceType = sourceData?.nodeType;
  const currentLabel = typeof edge.label === "string" ? edge.label : "";

  // Suggest labels based on the source node type
  let suggestions: { label: string; value: string }[] = [];
  if (sourceType === "condition") {
    suggestions = [
      { label: "true", value: "true" },
      { label: "false", value: "false" },
    ];
  } else if (sourceType === "buttons" || sourceType === "image_buttons") {
    const opts = (sourceData?.config?.options || []) as { label: string; value: string }[];
    suggestions = opts.map((o) => ({ label: `${o.label} (${o.value})`, value: o.value }));
    suggestions.push({ label: "(fallback / any)", value: "" });
  }

  return (
    <div>
      <div className="row">
        <div style={{ fontWeight: 600 }}>Edge</div>
        <div className="spacer" />
        <button className="btn danger" style={{ padding: "4px 8px", fontSize: 12 }} onClick={onDelete}>
          Delete edge
        </button>
      </div>
      <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>
        <div><strong>From:</strong> {edge.source}</div>
        <div><strong>To:</strong> {edge.target}</div>
      </div>

      <label style={{ marginTop: 12 }}>Condition label</label>
      <input
        value={currentLabel}
        onChange={(e) => onChange({ label: e.target.value || undefined })}
        placeholder="(unlabelled — default/fallback edge)"
      />

      {suggestions.length > 0 && (
        <>
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 6 }}>
            Quick set:
          </div>
          <div className="row" style={{ gap: 4, flexWrap: "wrap", marginTop: 4 }}>
            {suggestions.map((s) => (
              <button
                key={s.value}
                type="button"
                className={currentLabel === s.value ? "btn" : "btn ghost"}
                style={{ padding: "4px 10px", fontSize: 12 }}
                onClick={() => onChange({ label: s.value || undefined })}
              >
                {s.label}
              </button>
            ))}
          </div>
        </>
      )}

      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 10 }}>
        {sourceType === "condition" && (
          <>Condition nodes need two edges: one labelled <code>true</code>, one <code>false</code>.</>
        )}
        {(sourceType === "buttons" || sourceType === "image_buttons") && (
          <>Buttons node: label the edge with a button's <code>value</code> to route that choice.</>
        )}
        {!sourceType && (
          <>Leaving this blank makes it the default (unconditional) edge.</>
        )}
      </div>
    </div>
  );
}
