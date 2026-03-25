import { Routes, Route } from "react-router";
import { Layout } from "./components/layout/Layout";
import { DashboardPage } from "./pages/DashboardPage";
import { AgentsPage } from "./pages/AgentsPage";
import { SessionsPage } from "./pages/SessionsPage";
import { SessionDetailPage } from "./pages/SessionDetailPage";
import { ConfigPage } from "./pages/ConfigPage";
import { TopicsPage } from "./pages/TopicsPage";

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/sessions" element={<SessionsPage />} />
        <Route path="/sessions/:id" element={<SessionDetailPage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/config" element={<ConfigPage />} />
        <Route path="/topics" element={<TopicsPage />} />
      </Route>
    </Routes>
  );
}
