export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function getAuthHeaders(): Record<string, string> {
  const token = sessionStorage.getItem("openacp-token");
  if (token) return { Authorization: `Bearer ${token}` };
  return {};
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(),
      ...options?.headers,
    },
  });

  if (!res.ok) {
    if (res.status === 401) {
      sessionStorage.removeItem("openacp-token");
      window.location.reload();
      throw new ApiError(401, "Unauthorized");
    }
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(
      res.status,
      (body as Record<string, string>).error ?? res.statusText,
    );
  }

  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>(path),
  post: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    }),
  patch: <T>(path: string, body: unknown): Promise<T> =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  del: <T>(path: string): Promise<T> => request<T>(path, { method: "DELETE" }),
};
