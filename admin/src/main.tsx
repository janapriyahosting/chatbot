import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./index.css";
import "@xyflow/react/dist/style.css";
import { Login } from "./pages/Login";
import { Bots } from "./pages/Bots";
import { Sites } from "./pages/Sites";
import { FlowEditor } from "./pages/FlowEditor";
import { Users } from "./pages/Users";
import { Inbox } from "./pages/Inbox";
import { Leads } from "./pages/Leads";
import { Analytics } from "./pages/Analytics";
import { ApiKeys } from "./pages/ApiKeys";
import { WhatsApp } from "./pages/WhatsApp";
import { Templates } from "./pages/Templates";
import { Assets } from "./pages/Assets";
import { Settings } from "./pages/Settings";
import { useAuth } from "./store";

function Protected({ children }: { children: React.ReactNode }) {
  const token = useAuth((s) => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function HomeForRole() {
  const role = useAuth((s) => s.user?.role);
  if (role === "agent") return <Navigate to="/inbox" replace />;
  return <Bots />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <Protected>
              <HomeForRole />
            </Protected>
          }
        />
        <Route
          path="/bots/:botId/flows/:flowId"
          element={
            <Protected>
              <FlowEditor />
            </Protected>
          }
        />
        <Route path="/sites" element={<Protected><Sites /></Protected>} />
        <Route path="/users" element={<Protected><Users /></Protected>} />
        <Route path="/inbox" element={<Protected><Inbox /></Protected>} />
        <Route path="/leads" element={<Protected><Leads /></Protected>} />
        <Route path="/analytics" element={<Protected><Analytics /></Protected>} />
        <Route path="/api-keys" element={<Protected><ApiKeys /></Protected>} />
        <Route path="/whatsapp" element={<Protected><WhatsApp /></Protected>} />
        <Route path="/templates" element={<Protected><Templates /></Protected>} />
        <Route path="/assets" element={<Protected><Assets /></Protected>} />
        <Route path="/settings" element={<Protected><Settings /></Protected>} />
        {/* Legacy /admin/* paths redirect to the new layout */}
        <Route path="/admin/login" element={<Navigate to="/login" replace />} />
        <Route path="/admin" element={<Navigate to="/" replace />} />
        <Route path="/admin/*" element={<LegacyAdminRedirect />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);

// Strip "/admin" from any old bookmark and redirect to the new path.
function LegacyAdminRedirect() {
  const { pathname, search, hash } = window.location;
  const target = pathname.replace(/^\/admin/, "") + search + hash;
  return <Navigate to={target || "/"} replace />;
}
