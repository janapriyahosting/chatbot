import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  addEdge,
  reconnectEdge,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import type { Connection, Edge, Node } from "@xyflow/react";
import { api } from "../api";
import { EdgeInspector } from "../flow/EdgeInspector";
import { NodeInspector, NODE_TYPES } from "../flow/Inspector";
import type { NodeType } from "../flow/Inspector";
import { Preview } from "../flow/Preview";

type FlowNodeData = { label: string; nodeType: NodeType; config: any };

let _counter = 0;
const genId = (type: string) => `${type}_${Date.now().toString(36)}_${_counter++}`;

function computeHierarchicalLayout(def: any): Record<string, { x: number; y: number }> {
  const nodes = (def.nodes || []) as { id: string }[];
  const edges = (def.edges || []) as { source: string; target: string }[];
  const start = def.start_node as string | undefined;

  const preds: Record<string, string[]> = {};
  for (const e of edges) (preds[e.target] ??= []).push(e.source);

  const NEG = -Infinity;
  const depth: Record<string, number> = {};
  for (const n of nodes) depth[n.id] = n.id === start ? 0 : NEG;

  for (let iter = 0; iter < nodes.length + 2; iter++) {
    let changed = false;
    for (const n of nodes) {
      const ps = preds[n.id] || [];
      if (!ps.length) continue;
      const best = Math.max(...ps.map((p) => depth[p] ?? NEG));
      if (best > NEG && best + 1 > depth[n.id]) {
        depth[n.id] = best + 1;
        changed = true;
      }
    }
    if (!changed) break;
  }
  for (const n of nodes) if (depth[n.id] === NEG) depth[n.id] = 0;

  const byDepth: Record<number, string[]> = {};
  for (const n of nodes) (byDepth[depth[n.id]] ??= []).push(n.id);

  const COLW = 260;
  const ROWH = 120;
  const positions: Record<string, { x: number; y: number }> = {};
  for (const [d, ids] of Object.entries(byDepth)) {
    ids.forEach((id, i) => {
      positions[id] = { x: 60 + Number(d) * COLW, y: 60 + i * ROWH };
    });
  }
  return positions;
}

function backendToReactFlow(def: any): { nodes: Node[]; edges: Edge[] } {
  const saved: Record<string, { x: number; y: number }> = def.__positions || {};
  const auto = computeHierarchicalLayout(def);
  const positions = { ...auto, ...saved };  // saved wins; auto fills in missing
  const nodes: Node[] = (def.nodes || []).map((n: any) => ({
    id: n.id,
    type: "default",
    position: positions[n.id] || { x: 60, y: 60 },
    data: { label: n.label || `${n.type}${n.id !== n.type ? ` · ${n.id}` : ""}`, nodeType: n.type, config: n.config || {} },
  }));
  const edges: Edge[] = (def.edges || []).map((e: any, i: number) => ({
    id: `e_${i}_${e.source}_${e.target}`,
    source: e.source,
    target: e.target,
    label: e.condition || undefined,
  }));
  return { nodes, edges };
}

function reactFlowToBackend(nodes: Node[], edges: Edge[], startNode: string): any {
  return {
    start_node: startNode,
    nodes: nodes.map((n) => ({
      id: n.id,
      type: (n.data as FlowNodeData).nodeType,
      config: (n.data as FlowNodeData).config || {},
    })),
    edges: edges.map((e) => ({
      source: e.source,
      target: e.target,
      ...(e.label ? { condition: String(e.label) } : {}),
    })),
    __positions: Object.fromEntries(nodes.map((n) => [n.id, n.position])),
  };
}

export function FlowEditor() {
  const { botId, flowId } = useParams();
  const [name, setName] = useState("");
  const [startNode, setStartNode] = useState<string>("start");
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [err, setErr] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [bot, setBot] = useState<any>(null);
  const [previewing, setPreviewing] = useState(false);
  // Track only the selected id. The full node is derived from the `nodes`
  // array on every render, so React Flow's occasionally-stale selection
  // snapshots can't stomp our latest data updates.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const loaded = useRef(false);
  const selected = selectedId ? nodes.find((n) => n.id === selectedId) || null : null;
  const selectedEdge = selectedEdgeId ? edges.find((e) => e.id === selectedEdgeId) || null : null;

  const updateEdge = (id: string, patch: Partial<Edge>) => {
    setEdges((es) => es.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  };
  const deleteEdge = (id: string) => {
    setEdges((es) => es.filter((e) => e.id !== id));
    setSelectedEdgeId(null);
  };

  useEffect(() => {
    if (!botId || !flowId || loaded.current) return;
    loaded.current = true;
    (async () => {
      try {
        const f = await api.getFlow(botId, flowId);
        const bots = await api.listBots();
        setBot(bots.find((b: any) => b.id === botId));
        setName(f.name);
        const def = f.definition || { nodes: [], edges: [], start_node: "start" };
        setStartNode(def.start_node || "start");
        const rf = backendToReactFlow(def);
        setNodes(rf.nodes);
        setEdges(rf.edges);
      } catch (e: any) { setErr(e.message); }
    })();
  }, [botId, flowId, setNodes, setEdges]);

  const onConnect = useCallback(
    (conn: Connection) => setEdges((eds) => addEdge({ ...conn, id: `e_${Date.now()}_${conn.source}_${conn.target}` }, eds)),
    [setEdges]
  );
  // Re-wire an existing edge by dragging either endpoint onto another node.
  const onReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) =>
      setEdges((eds) => reconnectEdge(oldEdge, newConnection, eds)),
    [setEdges]
  );

  const addNode = (type: NodeType) => {
    // Reserve literal `start`/`end` ids for the FIRST such node. Additional
    // start/end nodes get unique ids so multi-branch flows with several ends
    // (e.g., one per condition branch) can't accidentally share an id.
    const taken = new Set(nodes.map((n) => n.id));
    let id: string;
    if (type === "start") {
      if (nodes.some((n) => (n.data as FlowNodeData).nodeType === "start")) {
        setErr("only one start node allowed"); return;
      }
      id = "start";
    } else if (type === "end") {
      id = taken.has("end") ? genId("end") : "end";
    } else {
      id = genId(type);
    }
    const newNode: Node = {
      id,
      type: "default",
      position: { x: 120 + nodes.length * 40, y: 120 + nodes.length * 40 },
      data: { label: `${type}${id !== type ? ` · ${id}` : ""}`, nodeType: type, config: {} },
    };
    setNodes((ns) => [...ns, newNode]);
    if (type === "start") setStartNode(id);
  };

  const updateNode = (id: string, patch: Partial<FlowNodeData>) => {
    setNodes((ns) => ns.map((n) =>
      n.id === id ? { ...n, data: { ...(n.data as FlowNodeData), ...patch } } : n
    ));
    // `selected` is derived from `nodes` on each render — no separate write.
  };

  const deleteSelected = () => {
    if (!selected) return;
    setNodes((ns) => ns.filter((n) => n.id !== selected.id));
    setEdges((es) => es.filter((e) => e.source !== selected.id && e.target !== selected.id));
    setSelectedId(null);
  };

  const duplicateSelected = () => {
    if (!selected) return;
    const src = selected;
    const data = src.data as FlowNodeData;
    if (data.nodeType === "start" || data.nodeType === "end") return; // skip terminals
    const newId = genId(data.nodeType);
    const clone: Node = {
      id: newId,
      type: "default",
      position: { x: src.position.x + 40, y: src.position.y + 40 },
      data: { label: `${data.nodeType} · ${newId}`, nodeType: data.nodeType, config: JSON.parse(JSON.stringify(data.config || {})) },
    };
    setNodes((ns) => [...ns, clone]);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const target = e.target as HTMLElement | null;
      const typing = target && /INPUT|TEXTAREA|SELECT/.test(target.tagName);
      if (typing) return;
      if (mod && (e.key === "d" || e.key === "D")) {
        e.preventDefault();
        duplicateSelected();
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        // react-flow also handles delete; this catches cases where focus is not on canvas
        e.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const save = async (publish: boolean) => {
    if (!botId || !flowId) return;
    setSaving(true); setErr(null); setWarnings([]);
    try {
      const definition = reactFlowToBackend(nodes, edges, startNode);
      const r = await api.updateFlow(botId, flowId, { name, definition });
      setWarnings(r.warnings || []);
      if (publish) await api.publishFlow(botId, flowId);
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const snippet = useMemo(() => {
    if (!bot) return "";
    return `<script src="${window.location.origin}/static/widget.js" data-bot-id="${bot.public_key}" data-api="${window.location.origin}"></script>`;
  }, [bot]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <div className="topbar">
        <div className="row">
          <Link to="/">← Bots</Link>
          <input value={name} onChange={(e) => setName(e.target.value)}
            style={{ width: 260, padding: 6, color: "#111" }} />
        </div>
        <div className="row">
          {err && <span className="error">{err}</span>}
          <button
            type="button"
            className="btn ghost"
            title="Reset node positions to a clean hierarchical layout"
            onClick={() => {
              const def = reactFlowToBackend(nodes, edges, startNode);
              def.__positions = {};
              const rf = backendToReactFlow(def);
              setNodes(rf.nodes);
            }}
            disabled={saving}
          >
            ⟳ Auto-layout
          </button>
          <button className="btn ghost" onClick={() => setPreviewing(true)} disabled={saving}>▶ Preview</button>
          <button className="btn ghost" onClick={() => save(false)} disabled={saving}>Save draft</button>
          <button className="btn" onClick={() => save(true)} disabled={saving}>Save &amp; publish</button>
        </div>
      </div>

      {warnings.length > 0 && (
        <div style={{ background: "#fef3c7", borderBottom: "1px solid #fde68a", padding: "6px 14px", fontSize: 12, color: "#92400e" }}>
          ⚠ {warnings.length} warning{warnings.length > 1 ? "s" : ""}:{" "}
          {warnings.map((w, i) => (<span key={i}>{i ? " · " : ""}{w}</span>))}
        </div>
      )}

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* Palette */}
        <div style={{ width: 180, borderRight: "1px solid #e5e7eb", padding: 10, background: "#fff", overflowY: "auto" }}>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>Add node</div>
          <div className="grid">
            {NODE_TYPES.map((t) => (
              <button key={t} className="btn ghost" style={{ textAlign: "left" }} onClick={() => addNode(t)}>
                + {t}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 16 }}>Start: <code>{startNode}</code></div>
          {bot && (
            <div style={{ marginTop: 16, fontSize: 12 }}>
              <div style={{ color: "#6b7280" }}>Embed snippet:</div>
              <textarea readOnly value={snippet} style={{ fontSize: 11, fontFamily: "ui-monospace" }} />
            </div>
          )}
        </div>

        {/* Canvas */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onReconnect={onReconnect}
            edgesReconnectable={true}
            deleteKeyCode={["Backspace", "Delete"]}
            onSelectionChange={({ nodes: sn, edges: se }) => {
              setSelectedId(sn?.[0]?.id ?? null);
              setSelectedEdgeId(se?.[0]?.id ?? null);
            }}
            onEdgeClick={(_, edge) => {
              setSelectedEdgeId(edge.id);
              setSelectedId(null);
            }}
            onNodeClick={() => setSelectedEdgeId(null)}
            fitView
          >
            <MiniMap />
            <Controls />
            <Background />
          </ReactFlow>
        </div>

        {/* Inspector */}
        <div data-cb-inspector style={{ width: 320, borderLeft: "1px solid #e5e7eb", padding: 12, background: "#fff", overflowY: "auto" }}>
          {selectedEdge ? (
            <EdgeInspector
              key={selectedEdge.id}
              edge={selectedEdge}
              sourceNode={nodes.find((n) => n.id === selectedEdge.source) || null}
              onChange={(patch) => updateEdge(selectedEdge.id, patch)}
              onDelete={() => deleteEdge(selectedEdge.id)}
            />
          ) : selected ? (
            <NodeInspector
              key={selected.id}
              node={selected}
              onChange={(patch) => updateNode(selected.id, patch)}
              onDelete={deleteSelected}
              onMakeStart={() => setStartNode(selected.id)}
              isStart={selected.id === startNode}
              allNodes={nodes}
            />
          ) : (
            <div style={{ color: "#6b7280", fontSize: 13 }}>
              Select a node or edge to edit.
              <br /><br />
              Tip: click an edge from a <code>condition</code> node to label it
              <code>true</code> or <code>false</code>. Click an edge from a <code>buttons</code>
              node to set the branch value.
            </div>
          )}
        </div>
      </div>
      {previewing && botId && (
        <Preview
          botId={botId}
          definition={reactFlowToBackend(nodes, edges, startNode)}
          onClose={() => setPreviewing(false)}
        />
      )}
    </div>
  );
}
