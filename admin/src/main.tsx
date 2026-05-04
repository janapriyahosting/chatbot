import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./index.css";
import "@xyflow/react/dist/style.css";
import { Login } from "./pages/Login";
import { Bots } from "./pages/Bots";
import { FlowEditor } from "./pages/FlowEditor";
import { Users } from "./pages/Users";
import { Inbox } from "./pages/Inbox";
import { Leads } from "./pages/Leads";
import { Analytics } from "./pages/Analytics";
import { ApiKeys } from "./pages/ApiKeys";
import { WhatsApp } from "./pages/WhatsApp";
import { useAuth } from "./store";

function Protected({ children }: { children: React.ReactNode }) {
  const token = useAuth((s) => s.token);
  if (!token) return <Navigate to="/admin/login" replace />;
  return <>{children}</>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/admin/login" element={<Login />} />
        <Route
          path="/admin"
          element={
            <Protected>
              <Bots />
            </Protected>
          }
        />
        <Route
          path="/admin/bots/:botId/flows/:flowId"
          element={
            <Protected>
              <FlowEditor />
            </Protected>
          }
        />
        <Route path="/admin/users" element={<Protected><Users /></Protected>} />
        <Route path="/admin/inbox" element={<Protected><Inbox /></Protected>} />
        <Route path="/admin/leads" element={<Protected><Leads /></Protected>} />
        <Route path="/admin/analytics" element={<Protected><Analytics /></Protected>} />
        <Route path="/admin/api-keys" element={<Protected><ApiKeys /></Protected>} />
        <Route path="/admin/whatsapp" element={<Protected><WhatsApp /></Protected>} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
