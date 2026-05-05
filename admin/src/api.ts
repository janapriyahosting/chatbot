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
  listBots: () => req<any[]>("GET", "/bots"),
  createBot: (body: { name: string; channel: string; site_id?: string }) =>
    req<any>("POST", "/bots", body),
  listSites: () => req<any[]>("GET", "/sites"),
  createSite: (body: { name: string; domain: string }) =>
    req<any>("POST", "/sites", body),
  listFlows: (botId: string) => req<any[]>("GET", `/bots/${botId}/flows`),
  createFlow: (botId: string, body: { name: string; definition: any }) =>
    req<any>("POST", `/bots/${botId}/flows`, body),
  getFlow: (botId: string, flowId: string) =>
    req<any>("GET", `/bots/${botId}/flows/${flowId}`),
  updateFlow: (botId: string, flowId: string, body: { name?: string; definition?: any }) =>
    req<any>("PATCH", `/bots/${botId}/flows/${flowId}`, body),
  publishFlow: (botId: string, flowId: string) =>
    req<any>("POST", `/bots/${botId}/flows/${flowId}/publish`),
  listUsers: () => req<any[]>("GET", "/users"),
  createUser: (body: { email: string; display_name: string; role: string; password: string }) =>
    req<any>("POST", "/users", body),
  updateUser: (id: string, body: any) => req<any>("PATCH", `/users/${id}`, body),
  deleteUser: (id: string) => req<any>("DELETE", `/users/${id}`),
  listConversations: (scope: "mine" | "queue" | "all" | "closed") =>
    req<any[]>("GET", `/agent/conversations?scope=${scope}`),
  getConversation: (id: string) => req<any>("GET", `/agent/conversations/${id}`),
  postAgentMessage: (id: string, text: string) =>
    req<any>("POST", `/agent/conversations/${id}/message`, { text }),
  postAgentAttachment: (id: string, opts: { url: string; kind: "image" | "document"; filename?: string; caption?: string }) =>
    req<any>("POST", `/agent/conversations/${id}/message`, {
      text: opts.caption || "",
      attachment_url: opts.url,
      attachment_kind: opts.kind,
      attachment_filename: opts.filename,
    }),
  closeConversation: (id: string) =>
    req<any>("POST", `/agent/conversations/${id}/close`),
  conversationCounts: () =>
    req<Record<string, number>>("GET", "/agent/conversations/counts"),
  listTemplates: () =>
    req<Array<{ id: string; title: string; body: string; sort_order: number }>>("GET", "/templates"),
  createTemplate: (body: { title: string; body: string; sort_order: number }) =>
    req<any>("POST", "/templates", body),
  updateTemplate: (id: string, body: { title: string; body: string; sort_order: number }) =>
    req<any>("PATCH", `/templates/${id}`, body),
  deleteTemplate: (id: string) =>
    req<any>("DELETE", `/templates/${id}`),
  getWorkingHours: () =>
    req<{ schedule: any }>("GET", "/settings/working-hours"),
  putWorkingHours: (schedule: any) =>
    req<{ schedule: any }>("PUT", "/settings/working-hours", { schedule }),
  getSmtp: () =>
    req<any>("GET", "/settings/smtp"),
  putSmtp: (body: any) =>
    req<any>("PUT", "/settings/smtp", body),
  getO365: () =>
    req<any>("GET", "/settings/o365"),
  putO365: (body: any) =>
    req<any>("PUT", "/settings/o365", body),
  getWhatsApp: () =>
    req<any>("GET", "/settings/whatsapp"),
  putWhatsApp: (body: any) =>
    req<any>("PUT", "/settings/whatsapp", body),
  polishMessage: (text: string, tone?: string) =>
    req<{ text: string }>("POST", "/agent/polish", { text, tone }),
  assignConversation: (id: string, userId: string | null) =>
    req<any>("POST", `/agent/conversations/${id}/assign`, { user_id: userId }),
  searchConversations: (q: string) =>
    req<any[]>("GET", `/agent/search?q=${encodeURIComponent(q)}`),
  previewFlow: (botId: string, definition: any, reply: any, context: any) =>
    req<any>("POST", `/bots/${botId}/flows/preview`, { definition, reply, context }),
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
