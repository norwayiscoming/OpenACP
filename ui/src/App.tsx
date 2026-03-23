import { Routes, Route } from "react-router";
import { Layout } from "./components/layout/Layout";
import { DashboardPage } from "./pages/DashboardPage";
import { AgentsPage } from "./pages/AgentsPage";
import { SessionsPage } from "./pages/SessionsPage";
import { SessionDetailPage } from "./pages/SessionDetailPage";

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/sessions" element={<SessionsPage />} />
        <Route path="/sessions/:id" element={<SessionDetailPage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route
          path="/config"
          element={<div className="text-xl">Config — coming soon</div>}
        />
        <Route
          path="/topics"
          element={<div className="text-xl">Topics — coming soon</div>}
        />
      </Route>
    </Routes>
  );
}
