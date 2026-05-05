import { useAuth } from "./store";

// Same-origin in production (served from FastAPI). Vite dev proxies via vite.config.ts.
const BASE = "";

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = useAuth.getState().token;
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    useAuth.getState().clear();
    throw new Error("unauthorized");
  }
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail || detail; } catch {}
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return res.status === 204 ? (undefined as T) : await res.json();
}

export const api = {
  login: (email: string, password: string) =>
    req<{ access_token: string; user: any }>("POST", "/auth/login", { email, password }),
  me: () => req<any>("GET", "/auth/me"),
  listBots: () => req<any[]>("GET", "/api/bots"),
  createBot: (body: { name: string; channel: string; site_id?: string }) =>
    req<any>("POST", "/api/bots", body),
  listSites: () => req<any[]>("GET", "/api/sites"),
  createSite: (body: { name: string; domain: string }) =>
    req<any>("POST", "/api/sites", body),
  listFlows: (botId: string) => req<any[]>("GET", `/api/bots/${botId}/flows`),
  createFlow: (botId: string, body: { name: string; definition: any }) =>
    req<any>("POST", `/api/bots/${botId}/flows`, body),
  getFlow: (botId: string, flowId: string) =>
    req<any>("GET", `/api/bots/${botId}/flows/${flowId}`),
  updateFlow: (botId: string, flowId: string, body: { name?: string; definition?: any }) =>
    req<any>("PATCH", `/api/bots/${botId}/flows/${flowId}`, body),
  publishFlow: (botId: string, flowId: string) =>
    req<any>("POST", `/api/bots/${botId}/flows/${flowId}/publish`),
  listUsers: () => req<any[]>("GET", "/api/users"),
  createUser: (body: { email: string; display_name: string; role: string; password: string }) =>
    req<any>("POST", "/api/users", body),
  updateUser: (id: string, body: any) => req<any>("PATCH", `/api/users/${id}`, body),
  deleteUser: (id: string) => req<any>("DELETE", `/api/users/${id}`),
  listConversations: (scope: "mine" | "queue" | "all" | "closed") =>
    req<any[]>("GET", `/api/agent/conversations?scope=${scope}`),
  getConversation: (id: string) => req<any>("GET", `/api/agent/conversations/${id}`),
  postAgentMessage: (id: string, text: string) =>
    req<any>("POST", `/api/agent/conversations/${id}/message`, { text }),
  postAgentAttachment: (id: string, opts: { url: string; kind: "image" | "document"; filename?: string; caption?: string }) =>
    req<any>("POST", `/api/agent/conversations/${id}/message`, {
      text: opts.caption || "",
      attachment_url: opts.url,
      attachment_kind: opts.kind,
      attachment_filename: opts.filename,
    }),
  closeConversation: (id: string) =>
    req<any>("POST", `/api/agent/conversations/${id}/close`),
  conversationCounts: () =>
    req<Record<string, number>>("GET", "/api/agent/conversations/counts"),
  listTemplates: () =>
    req<Array<{ id: string; title: string; body: string; sort_order: number }>>("GET", "/api/templates"),
  createTemplate: (body: { title: string; body: string; sort_order: number }) =>
    req<any>("POST", "/api/templates", body),
  updateTemplate: (id: string, body: { title: string; body: string; sort_order: number }) =>
    req<any>("PATCH", `/api/templates/${id}`, body),
  deleteTemplate: (id: string) =>
    req<any>("DELETE", `/api/templates/${id}`),
  getWorkingHours: () =>
    req<{ schedule: any }>("GET", "/api/settings/working-hours"),
  putWorkingHours: (schedule: any) =>
    req<{ schedule: any }>("PUT", "/api/settings/working-hours", { schedule }),
  getSmtp: () =>
    req<any>("GET", "/api/settings/smtp"),
  putSmtp: (body: any) =>
    req<any>("PUT", "/api/settings/smtp", body),
  getO365: () =>
    req<any>("GET", "/api/settings/o365"),
  putO365: (body: any) =>
    req<any>("PUT", "/api/settings/o365", body),
  getWhatsApp: () =>
    req<any>("GET", "/api/settings/whatsapp"),
  putWhatsApp: (body: any) =>
    req<any>("PUT", "/api/settings/whatsapp", body),
  getAdminStatus: () =>
    req<any>("GET", "/api/admin/status"),
  restartService: () =>
    req<any>("POST", "/api/admin/restart"),
  polishMessage: (text: string, tone?: string) =>
    req<{ text: string }>("POST", "/api/agent/polish", { text, tone }),
  assignConversation: (id: string, userId: string | null) =>
    req<any>("POST", `/api/agent/conversations/${id}/assign`, { user_id: userId }),
  searchConversations: (q: string) =>
    req<any[]>("GET", `/api/agent/search?q=${encodeURIComponent(q)}`),
  previewFlow: (botId: string, definition: any, reply: any, context: any) =>
    req<any>("POST", `/api/bots/${botId}/flows/preview`, { definition, reply, context }),
  listUploads: (kind?: "image" | "video" | "document") =>
    req<any[]>("GET", `/uploads/list${kind ? `?kind=${kind}` : ""}`),
  deleteUpload: (filename: string) =>
    req<any>("POST", "/uploads/delete", { filename }),
  uploadFile: async (file: File): Promise<{ url: string; filename: string }> => {
    const fd = new FormData();
    fd.append("file", file);
    const token = useAuth.getState().token;
    const res = await fetch("/uploads", {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: fd,
    });
    if (!res.ok) {
      let d = res.statusText;
      try { d = (await res.json()).detail || d; } catch {}
      throw new Error(typeof d === "string" ? d : JSON.stringify(d));
    }
    return res.json();
  },
};
