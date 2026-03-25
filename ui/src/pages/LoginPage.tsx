import { useState, useCallback } from "react";
import { Button } from "../components/shared/Button";

interface LoginPageProps {
  onLogin: (token: string) => void;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!token.trim()) return;

      setValidating(true);
      setError(null);

      try {
        const res = await fetch("/api/sessions", {
          headers: { Authorization: `Bearer ${token.trim()}` },
        });
        if (res.ok) {
          onLogin(token.trim());
        } else if (res.status === 401) {
          setError("Invalid token. Check ~/.openacp/api-secret");
        } else {
          setError(`Server error: ${res.status}`);
        }
      } catch {
        setError("Cannot connect to server");
      } finally {
        setValidating(false);
      }
    },
    [token, onLogin],
  );

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black bg-gradient-to-br from-primary to-purple-500 bg-clip-text text-transparent">
            OpenACP
          </h1>
          <p className="text-sm text-zinc-500 mt-2">Dashboard Login</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">
              API Token
            </label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste token here..."
              autoFocus
              className="w-full px-4 py-2.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono"
            />
            <p className="text-xs text-zinc-400 mt-2">
              Find your token in{" "}
              <code className="px-1 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded text-xs">
                ~/.openacp/api-secret
              </code>
            </p>
          </div>

          {error && (
            <div className="text-sm text-danger bg-danger/10 px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            disabled={validating || !token.trim()}
            className="w-full"
          >
            {validating ? "Validating..." : "Login"}
          </Button>
        </form>
      </div>
    </div>
  );
}
