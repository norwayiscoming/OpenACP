import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { LoginPage } from "../pages/LoginPage";

interface AuthContextValue {
  token: string | null;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  token: null,
  logout: () => {},
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() =>
    sessionStorage.getItem("openacp-token"),
  );
  const [needsAuth, setNeedsAuth] = useState<boolean | null>(null); // null = checking

  // Check if auth is actually required by hitting a protected endpoint
  useEffect(() => {
    if (token) {
      setNeedsAuth(true); // already have token, skip check
      return;
    }
    fetch("/api/sessions")
      .then((res) => {
        if (res.status === 401) {
          setNeedsAuth(true);
        } else if (res.ok) {
          // 2xx — no auth required
          setNeedsAuth(false);
        } else {
          // 5xx or other errors — assume auth required (safer default)
          setNeedsAuth(true);
        }
      })
      .catch(() => setNeedsAuth(true));
  }, [token]);

  const handleLogin = useCallback((newToken: string) => {
    sessionStorage.setItem("openacp-token", newToken);
    setToken(newToken);
    setNeedsAuth(true);
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem("openacp-token");
    setToken(null);
    setNeedsAuth(true);
  }, []);

  // Still checking if auth is needed
  if (needsAuth === null) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  // Auth needed but no token
  if (needsAuth && !token) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return <AuthContext value={{ token, logout }}>{children}</AuthContext>;
}
