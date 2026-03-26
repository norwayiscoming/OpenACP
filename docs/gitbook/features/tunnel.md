# Tunneling

## What it is and why it matters

When your AI agent spins up a local development server — a React app on port 3000, a FastAPI service on port 8000, a database UI on port 5432 — that server is only reachable from your own machine. The tunnel feature solves this by establishing a secure public URL that proxies traffic to any local port.

You can share the URL with teammates, preview your app on a phone, or let a webhook service reach your local API. No manual port-forwarding or cloud deployment required.

OpenACP also runs an internal file viewer server. When an agent edits a file or produces a diff, the viewer generates a shareable link that renders the content with syntax highlighting (via Monaco editor) or side-by-side diff view.

---

## Providers

OpenACP supports four tunnel providers. The active provider is configured once in `~/.openacp/config.json` and applies to all tunnels.

### Cloudflare (default, free)

Uses the `cloudflared` binary to create ephemeral `*.trycloudflare.com` URLs. No account required. OpenACP installs `cloudflared` automatically to `~/.openacp/bin/cloudflared` if it is not already on your PATH.

Supports an optional custom `domain` if you have a Cloudflare account with a zone configured.

### ngrok

Uses the `ngrok` binary. Requires `ngrok` to be installed separately (https://ngrok.com/download). Supports `authtoken`, `domain`, and `region` options.

### bore

Uses the `bore` CLI to tunnel through `bore.pub` (or a self-hosted bore server). Requires `bore` to be installed (https://github.com/ekzhang/bore). Supports custom `server`, `port`, and `secret` options.

### Tailscale Funnel

Uses `tailscale funnel` to expose a port over your Tailscale network. Requires Tailscale to be installed and authenticated (https://tailscale.com/download). The provider resolves your Tailscale hostname via `tailscale status --json` to construct the public URL.

---

## Configuration

Add a `tunnel` block to `~/.openacp/config.json` (see [Configuration](../self-hosting/configuration.md) for the full `tunnel` config reference):

```json
{
  "tunnel": {
    "enabled": true,
    "provider": "cloudflare",
    "port": 7080,
    "maxUserTunnels": 5,
    "storeTtlMinutes": 60,
    "auth": {
      "enabled": false,
      "token": ""
    },
    "options": {}
  }
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `enabled` | `false` | Enable or disable the tunnel feature |
| `provider` | `"cloudflare"` | One of `cloudflare`, `ngrok`, `bore`, `tailscale` |
| `port` | `7080` | Local port for the internal file viewer server. Auto-increments if in use. |
| `maxUserTunnels` | `5` | Maximum number of simultaneous user-created tunnels |
| `storeTtlMinutes` | `60` | How long file/diff viewer entries are kept in memory |
| `auth.enabled` | `false` | Require a bearer token to access the file viewer |
| `options` | `{}` | Provider-specific options (see below) |

### Provider-specific options

**Cloudflare:**
```json
{ "options": { "domain": "my-app.example.com" } }
```

**ngrok:**
```json
{ "options": { "authtoken": "...", "domain": "my-app.ngrok.app", "region": "eu" } }
```

**bore:**
```json
{ "options": { "server": "bore.pub", "port": 2200, "secret": "mysecret" } }
```

**Tailscale:**
```json
{ "options": { "bg": true } }
```

---

## CLI commands

Tunnels can be managed from the terminal:

```bash
# Expose a local port
openacp tunnel add 3000 --label my-app

# List active tunnels and their public URLs
openacp tunnel list

# Stop a tunnel by port
openacp tunnel stop 3000

# Stop all user tunnels
openacp tunnel stop-all
```

Inside Telegram or Discord, if you have the agent integration installed, the agent can run these commands on your behalf — just ask it to "expose port 3000" or "give me a public URL for this Vite app."

---

## File viewer

The file viewer is an internal HTTP server that OpenACP starts alongside the tunnel. When an agent reads, edits, or writes a file, it can register that file or diff in the viewer and send you a clickable link.

- **File view** — renders file content with Monaco editor syntax highlighting. Supported languages include TypeScript, JavaScript, Python, Rust, Go, Java, Kotlin, Ruby, PHP, C/C++, C#, Swift, Bash, JSON, YAML, TOML, XML, HTML, CSS, SCSS, SQL, Markdown, Dockerfile, HCL, Vue, and Svelte.
- **Diff view** — renders a side-by-side diff of old vs. new content.

The viewer enforces a 1 MB per-entry size limit and rejects file paths that fall outside the session's working directory (path traversal protection). Entries expire automatically after `storeTtlMinutes` (default 60 minutes).

---

## Per-user tunnel limits

Each user or session can open up to `maxUserTunnels` tunnels simultaneously (default 5). This prevents runaway tunnel creation. Tunnels created by a session are tracked and can be stopped when the session ends via `stopBySession`.

---

## Security

- **Auth token**: When `auth.enabled` is true, all requests to the file viewer require a `Bearer <token>` header. Set `auth.token` to a secret value.
- **Path validation**: The viewer validates every file path against the session's `workingDirectory`. Files outside that directory are rejected.
- **TTL**: Viewer entries expire after `storeTtlMinutes`. Expired entries are cleaned up every 5 minutes.
- **Tunnel timeouts**: If a provider process does not establish a tunnel within 30 seconds, it is killed and an error is returned.
