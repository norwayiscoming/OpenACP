import { NavLink } from "react-router";
import { useAuth } from "../../contexts/auth-context";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: "\u25C9" },
  { to: "/sessions", label: "Sessions", icon: "\u25CE" },
  { to: "/agents", label: "Agents", icon: "\u25CE" },
  { to: "/config", label: "Config", icon: "\u25CE" },
  { to: "/topics", label: "Topics", icon: "\u25CE" },
];

export function Sidebar({ connectionStatus }: { connectionStatus: string }) {
  const { logout } = useAuth();

  return (
    <aside className="flex flex-col w-64 h-screen shrink-0 border-r border-white/20 dark:border-white/5 bg-white/40 dark:bg-zinc-950/40 backdrop-blur-xl z-30 transition-all">
      <div className="p-6 text-2xl font-black bg-gradient-to-br from-primary to-purple-500 bg-clip-text text-transparent drop-shadow-sm">
        OpenACP
      </div>

      <nav className="flex-1 px-4 space-y-2 mt-2">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-300 ${
                isActive
                  ? "bg-primary text-white shadow-lg shadow-primary/25 translate-x-1 outline-none"
                  : "text-zinc-600 dark:text-zinc-400 hover:bg-white/60 dark:hover:bg-zinc-800/50 hover:translate-x-1 outline-none"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={
                    isActive
                      ? "text-white"
                      : "text-primary/70 dark:text-primary/50"
                  }
                >
                  {item.icon}
                </span>
                {item.label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="p-6 mt-auto">
        <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-white/50 dark:bg-zinc-900/50 border border-white/20 dark:border-white/5 shadow-sm">
          <span
            className={`w-2 h-2 rounded-full shadow-sm ${
              connectionStatus === "connected"
                ? "bg-success shadow-success/50"
                : connectionStatus === "connecting"
                  ? "bg-warning animate-pulse shadow-warning/50"
                  : "bg-danger shadow-danger/50"
            }`}
          />
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {connectionStatus === "connected"
              ? "Online"
              : connectionStatus === "connecting"
                ? "Connecting..."
                : "Offline"}
          </span>
          <button
            onClick={logout}
            className="ml-auto text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            title="Logout"
          >
            Logout
          </button>
        </div>
      </div>
    </aside>
  );
}
