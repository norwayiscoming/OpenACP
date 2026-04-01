# App Connectivity

## What it is

App connectivity lets desktop and web clients discover and connect to a running OpenACP instance — both locally (same machine) and remotely (via tunnel). This enables future GUI apps, web dashboards, and mobile clients to interact with your OpenACP server.

---

## Local discovery

Apps running on the same machine can discover OpenACP instances by reading the instance registry at `~/.openacp/instances.json`. Each entry contains the instance root path, and the API port is found in `<instance-root>/api.port`.

No authentication prompts are needed for local connections — the app reads `<instance-root>/api-secret` directly (file permissions restrict access to the current user).

---

## Remote access

For remote connections (different machine, phone, or shared with a teammate), use `openacp remote`:

```bash
openacp remote
```

This displays:

- **Local URL** — `http://127.0.0.1:<port>` (same machine only)
- **Tunnel URL** — public HTTPS URL via your configured tunnel provider
- **App link** — `openacp://` custom scheme URL for native apps
- **QR code** — scan from your phone to connect

### One-time access codes

Remote links use single-use access codes instead of embedding secrets in the URL. When you run `openacp remote`:

1. A short-lived code is generated (valid for 30 minutes, single use).
2. The link includes `?code=<code>` as a query parameter.
3. When the app opens the link, it exchanges the code for a JWT access token via `POST /api/v1/auth/exchange`.
4. The code is consumed on first use — sharing the link twice does not work.

This prevents long-lived secrets from appearing in browser history, chat logs, or clipboard managers.

### Tunnel auto-start

If `tunnel.enabled` is `true` in your config, the tunnel starts automatically on server boot. The `openacp remote` command uses the existing tunnel URL. If the tunnel is not enabled, `openacp remote` shows only the local URL.

---

## Authentication flow

1. **`openacp remote`** generates a one-time code using the local API secret.
2. **App receives the link** and calls `POST /api/v1/auth/exchange` with the code.
3. **Server returns a JWT** with the appropriate role and scopes.
4. **App uses the JWT** for all subsequent API requests (`Authorization: Bearer <jwt>`).
5. **JWT refresh** — tokens can be refreshed within a 7-day window, even after expiration.

See [Security](../self-hosting/security.md) for details on roles, scopes, and token management.

---

## Connection methods

| Method | Use case | Auth |
|--------|----------|------|
| Local file discovery | Desktop apps on same machine | Reads `api-secret` file directly |
| `openacp remote` link | Share with phone/teammate | One-time code → JWT |
| QR code | Mobile app quick connect | Same as remote link |
| `openacp://` scheme | Native app deep link | Embedded code parameter |
