# REST API

The OpenACP daemon exposes a local HTTP API used by the CLI and the web dashboard.

**Base URL:** `http://127.0.0.1:21420` (configurable via `api.host` and `api.port`)

**Auth:** Bearer token from `~/.openacp/api-secret`

```bash
TOKEN=$(cat ~/.openacp/api-secret)
curl -H "Authorization: Bearer $TOKEN" http://localhost:21420/api/sessions
```

The secret file is created automatically with mode `0600` on first start. Protect it like an SSH private key.

**Exempt from auth:** `GET /api/health`, `GET /api/version`, `GET /api/events` (SSE uses query param `?token=`).

**Body size limit:** 1 MB.

---

## Health & System

### GET /api/health

Returns daemon health. No auth required.

**Response**
```json
{
  "status": "ok",
  "uptime": 123456,
  "version": "0.6.7",
  "memory": {
    "rss": 52428800,
    "heapUsed": 30000000,
    "heapTotal": 45000000
  },
  "sessions": {
    "active": 2,
    "total": 5
  },
  "adapters": ["telegram"],
  "tunnel": { "enabled": true, "url": "https://abc.trycloudflare.com" }
}
```

`uptime` is milliseconds since daemon start. `sessions.active` counts sessions with status `active` or `initializing`.

```bash
curl http://localhost:21420/api/health
```

---

### GET /api/version

Returns daemon version string. No auth required.

**Response**
```json
{ "version": "0.6.7" }
```

```bash
curl http://localhost:21420/api/version
```

---

### POST /api/restart

Sends a restart signal to the daemon. The daemon exits cleanly and the process manager (or `openacp start`) restarts it.

**Response**
```json
{ "ok": true, "message": "Restarting..." }
```

Returns `501` if restart is not available in the current run mode.

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" http://localhost:21420/api/restart
```

---

### GET /api/adapters

Lists registered channel adapters.

**Response**
```json
{
  "adapters": [
    { "name": "telegram", "type": "built-in" }
  ]
}
```

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:21420/api/adapters
```

---

## Sessions

### GET /api/sessions

Lists all sessions (active, finished, cancelled, error).

**Response**
```json
{
  "sessions": [
    {
      "id": "sess_abc123",
      "agent": "claude",
      "status": "active",
      "name": "Fix login bug",
      "workspace": "/home/user/myproject",
      "createdAt": "2026-03-25T10:00:00.000Z",
      "dangerousMode": false,
      "queueDepth": 0,
      "promptRunning": true,
      "lastActiveAt": "2026-03-25T10:05:00.000Z"
    }
  ]
}
```

Session `status` values: `initializing`, `active`, `finished`, `cancelled`, `error`.

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:21420/api/sessions
```

---

### GET /api/sessions/:id

Returns details for a single session.

**Response**
```json
{
  "session": {
    "id": "sess_abc123",
    "agent": "claude",
    "status": "active",
    "name": "Fix login bug",
    "workspace": "/home/user/myproject",
    "createdAt": "2026-03-25T10:00:00.000Z",
    "dangerousMode": false,
    "queueDepth": 1,
    "promptRunning": false,
    "threadId": "12345",
    "channelId": "telegram",
    "agentSessionId": "agent-internal-id"
  }
}
```

Returns `404` if not found.

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:21420/api/sessions/sess_abc123
```

---

### POST /api/sessions

Creates a new session.

**Request body** (all fields optional)
```json
{
  "agent": "claude",
  "workspace": "/path/to/project"
}
```

`agent` defaults to `defaultAgent` from config. `workspace` defaults to `workspace.baseDir`.

**Response**
```json
{
  "sessionId": "sess_abc123",
  "agent": "claude",
  "status": "initializing",
  "workspace": "/home/user/openacp-workspace"
}
```

Returns `429` if `maxConcurrentSessions` is reached.

Permissions are auto-approved for sessions created via the API when no channel adapter is attached.

```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"agent":"claude","workspace":"/path/to/project"}' \
  http://localhost:21420/api/sessions
```

---

### DELETE /api/sessions/:id

Cancels a session.

**Response**
```json
{ "ok": true }
```

Returns `404` if not found.

```bash
curl -X DELETE -H "Authorization: Bearer $TOKEN" \
  http://localhost:21420/api/sessions/sess_abc123
```

---

### POST /api/sessions/:id/prompt

Enqueues a prompt for a session. The session processes prompts serially; `queueDepth` indicates how many are waiting.

**Request body**
```json
{ "prompt": "Refactor the authentication module" }
```

**Response**
```json
{ "ok": true, "sessionId": "sess_abc123", "queueDepth": 1 }
```

Returns `400` if the session is `cancelled`, `finished`, or `error`. Returns `404` if not found.

```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Fix the login bug"}' \
  http://localhost:21420/api/sessions/sess_abc123/prompt
```

---

### PATCH /api/sessions/:id/dangerous

Enables or disables dangerous mode for a session.

**Request body**
```json
{ "enabled": true }
```

**Response**
```json
{ "ok": true, "dangerousMode": true }
```

```bash
curl -X PATCH \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"enabled":true}' \
  http://localhost:21420/api/sessions/sess_abc123/dangerous
```

---

### POST /api/sessions/:id/permission

Resolves a pending permission request for a session.

**Request body**
```json
{ "permissionId": "perm_xyz", "optionId": "allow" }
```

**Response**
```json
{ "ok": true }
```

Returns `400` if there is no matching pending request.

---

### POST /api/sessions/:id/summary

Requests the agent to generate a summary name for the session.

**Response**
```json
{ "ok": true, "name": "Refactor auth module" }
```

---

### POST /api/sessions/:id/archive

Archives a session.

**Response**
```json
{ "ok": true }
```

---

### POST /api/sessions/adopt

Adopts an existing external agent session and surfaces it as a messaging thread.

**Request body**
```json
{
  "agent": "claude",
  "agentSessionId": "external-session-id",
  "cwd": "/path/to/project",
  "channel": "telegram"
}
```

`agent` and `agentSessionId` are required. `cwd` defaults to the daemon's working directory. `channel` defaults to the first registered adapter.

**Response**
```json
{ "ok": true, "sessionId": "sess_abc123", "threadId": "12345", "status": "new" }
```

`status` is `"existing"` if the session was already active (topic is pinged instead of created). Returns `429` on session limit, `400` for unsupported agent.

---

## Agents

### GET /api/agents

Lists agents configured in the daemon.

**Response**
```json
{
  "agents": [
    {
      "name": "claude",
      "command": "claude-agent-acp",
      "args": [],
      "capabilities": { "integration": "claude" }
    }
  ],
  "default": "claude"
}
```

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:21420/api/agents
```

---

## Configuration

### GET /api/config

Returns the full runtime config. Sensitive fields (`botToken`, `token`, `apiKey`, `secret`, `password`, `webhookSecret`) are redacted to `"***"`.

**Response**
```json
{ "config": { "defaultAgent": "claude", "channels": { ... }, ... } }
```

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:21420/api/config
```

---

### PATCH /api/config

Updates a single config value by dot-notation path. Only fields marked as `safe` in the config registry can be modified via the API.

**Request body**
```json
{ "path": "security.maxConcurrentSessions", "value": 10 }
```

`value` can be any JSON type. String values that parse as JSON are used as-is.

**Response**
```json
{
  "ok": true,
  "needsRestart": false,
  "config": { ... }
}
```

`needsRestart: true` means the change requires a daemon restart to take effect. Returns `403` for fields not in the safe-fields scope.

```bash
curl -X PATCH \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"path":"security.maxConcurrentSessions","value":10}' \
  http://localhost:21420/api/config
```

---

### GET /api/config/editable

Returns metadata about editable config fields (used by the web dashboard). Includes `path`, `displayName`, `group`, `type`, `options`, `value`, and `hotReload`.

---

## Topics

Topics represent channel adapter threads (Telegram forum topics, Discord threads, etc.).

### GET /api/topics

Lists all topics. Optionally filter by status.

**Query params**

| Param | Description |
|---|---|
| `status` | Comma-separated status filter, e.g. `active,finished` |

**Response**
```json
{
  "topics": [
    {
      "sessionId": "sess_abc123",
      "topicId": 42,
      "name": "Fix login bug",
      "status": "active",
      "agentName": "claude",
      "lastActiveAt": "2026-03-25T10:05:00.000Z"
    }
  ]
}
```

Returns `501` if topic management is not available (no adapter with topic support).

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:21420/api/topics?status=active,finished"
```

---

### DELETE /api/topics/:sessionId

Deletes the topic for a session. Returns `409` if the session is active and `--force` is not set. Returns `403` for system topics.

**Query params**

| Param | Description |
|---|---|
| `force` | Set to `true` to delete even if the session is active |

**Response**
```json
{ "ok": true, "topicId": 42 }
```

```bash
curl -X DELETE -H "Authorization: Bearer $TOKEN" \
  "http://localhost:21420/api/topics/sess_abc123?force=true"
```

---

### POST /api/topics/cleanup

Deletes all topics matching the given statuses. Returns counts of deleted and failed topics.

**Request body** (optional)
```json
{ "statuses": ["finished", "error"] }
```

**Response**
```json
{ "deleted": ["sess_abc123", "sess_def456"], "failed": [] }
```

---

## Tunnel

### GET /api/tunnel

Returns tunnel status for the primary tunnel service.

**Response** (when enabled)
```json
{ "enabled": true, "url": "https://abc.trycloudflare.com", "provider": "cloudflare" }
```

**Response** (when disabled)
```json
{ "enabled": false }
```

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:21420/api/tunnel
```

---

### GET /api/tunnel/list

Lists all active user tunnels.

**Response**
```json
[
  { "port": 3000, "label": "dev server", "status": "active", "publicUrl": "https://xyz.trycloudflare.com" }
]
```

---

### POST /api/tunnel

Creates a new tunnel to a local port.

**Request body**
```json
{ "port": 3000, "label": "dev server", "sessionId": "sess_abc123" }
```

`port` is required. `label` and `sessionId` are optional.

**Response**
```json
{ "port": 3000, "publicUrl": "https://xyz.trycloudflare.com", "label": "dev server", "status": "active" }
```

Returns `400` if the tunnel service is not enabled.

```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"port":3000,"label":"dev server"}' \
  http://localhost:21420/api/tunnel
```

---

### DELETE /api/tunnel/:port

Stops the tunnel for a specific local port.

**Response**
```json
{ "ok": true }
```

```bash
curl -X DELETE -H "Authorization: Bearer $TOKEN" \
  http://localhost:21420/api/tunnel/3000
```

---

### DELETE /api/tunnel

Stops all user tunnels.

**Response**
```json
{ "ok": true, "stopped": 3 }
```

---

## Notifications

### POST /api/notify

Sends a notification message to all registered channel adapters (e.g. to the Notifications topic in Telegram).

**Request body**
```json
{ "message": "Deployment complete" }
```

**Response**
```json
{ "ok": true }
```

```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"Deployment complete"}' \
  http://localhost:21420/api/notify
```

---

## Server-Sent Events

### GET /api/events

SSE stream of real-time daemon events. Auth via query parameter (EventSource cannot set headers).

```
GET /api/events?token=<api-secret>
```

Returns a persistent SSE connection. Events include session lifecycle changes, agent output, and health pings.
