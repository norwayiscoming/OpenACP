import { Routes, Route } from "react-router";
import { Layout } from "./components/layout/Layout";
import { DashboardPage } from "./pages/DashboardPage";

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route
          path="/sessions"
          element={<div className="text-xl">Sessions — coming soon</div>}
        />
        <Route
          path="/sessions/:id"
          element={<div className="text-xl">Session Detail — coming soon</div>}
        />
        <Route
          path="/agents"
          element={<div className="text-xl">Agents — coming soon</div>}
        />
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
