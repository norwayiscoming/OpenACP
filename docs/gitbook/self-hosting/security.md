# Security

## User Allowlist

By default, any user who can send messages to your bot can create sessions. To restrict access to a specific set of users, populate `security.allowedUserIds` in your config:

```json
"security": {
  "allowedUserIds": ["123456789", "987654321"]
}
```

Values are platform user IDs as strings. For Telegram, this is the numeric user ID. For Discord, it is the user snowflake.

When the list is non-empty, `SecurityGuard.checkAccess()` rejects any incoming message whose `userId` is not in the list. The user receives no response (the message is silently dropped). An empty list means all users are allowed — this is the default and is appropriate when your bot is in a private group that only you can access.

To find your user ID:
- **Telegram**: Message `@userinfobot` or `@getidsbot`.
- **Discord**: Enable Developer Mode in Settings, then right-click your username and select "Copy User ID".

## Concurrent Session Limits

```json
"security": {
  "maxConcurrentSessions": 20
}
```

This is a hard cap on the number of sessions with status `active` or `initializing` across all channels at any given moment. When the limit is reached, new incoming messages are rejected with a "Session limit reached" response until an existing session completes.

The default of 20 is generous for personal use. Reduce it if you are on a machine with limited resources or want to prevent accidental runaway usage.

## Session Timeout

```json
"security": {
  "sessionTimeoutMinutes": 60
}
```

Sessions that have been idle (no new prompt sent) for longer than this value are eligible for automatic cleanup. The default is 60 minutes.

## API Bearer Token

The local REST API (default port `21420`) is protected by a bearer token. The token is stored in:

```
~/.openacp/api-secret
```

This file is created automatically on first start with `0600` permissions (owner read/write only). The token is a 64-character hex string generated with `crypto.randomBytes(32)`.

At startup, if the file permissions are more permissive than `0600`, a warning is logged:

```
API secret file has insecure permissions (should be 0600). Run: chmod 600 ~/.openacp/api-secret
```

To authenticate API requests, include the token in the `Authorization` header:

```http
Authorization: Bearer <contents of ~/.openacp/api-secret>
```

The CLI reads this file automatically when talking to a running daemon, so you do not need to manage it manually for normal use.

Do not expose the API port externally. The default `host: "127.0.0.1"` binding ensures the API is only reachable from localhost. If you change `api.host` to `0.0.0.0`, the server logs a warning — ensure your firewall blocks external access to port `21420`.

## Dangerous Mode

Some agent operations (file writes, command execution) require explicit user approval via permission request buttons in the chat. This is the default behavior. For details on how permissions work from a user's perspective, see [Permissions](../using-openacp/permissions.md).

If an agent is configured to run without permission prompts (agent-side configuration), ensure your allowlist is restricted to trusted users only, since any allowlisted user will have the ability to trigger unrestricted agent actions.

## Best Practices

1. **Always set `allowedUserIds`** unless your bot is already in a fully private, access-controlled group. Even a private Telegram group can have its invite link shared accidentally.

2. **Keep `api-secret` at `0600`**. The CLI warns you if it is not. Run `chmod 600 ~/.openacp/api-secret` if needed.

3. **Do not change `api.host` to `0.0.0.0`** unless you have a specific need and have locked down port `21420` with firewall rules.

4. **Review `maxConcurrentSessions`** if you share the bot with multiple users. A session per user is reasonable; 20 concurrent ACP agent subprocesses can be resource-intensive.

5. **Rotate the API secret** by deleting `~/.openacp/api-secret` and restarting the daemon. A new token is generated automatically.

6. **Use daemon mode with autostart** for persistent deployments so the server does not silently go offline after a reboot.
