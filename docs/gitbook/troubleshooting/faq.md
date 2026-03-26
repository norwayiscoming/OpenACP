# FAQ

### What operating systems does OpenACP support?

OpenACP runs on macOS, Linux, and Windows (via WSL). It requires Node.js 20 or later. Native Windows (PowerShell/CMD) is not officially tested — WSL 2 is recommended on Windows.

---

### Can I run multiple bots for different platforms at the same time?

Yes. OpenACP supports multiple channel adapters simultaneously. You can enable Telegram, Discord, and Slack in the same `config.json` — all three will start when you run `openacp start`. Each platform gets its own adapter instance sharing a single agent backend.

---

### Is my data private? Does OpenACP send data anywhere?

OpenACP itself does not collect or transmit any telemetry. All data stays on your machine in `~/.openacp/`. Your messages are sent directly from your machine to the AI agent (e.g., Claude, Codex) via the agent's own API. Review each agent's privacy policy independently — OpenACP is just the bridge.

---

### Does OpenACP cost money?

OpenACP is free and open source. However, the AI agents it connects to (Claude, Codex, Gemini, etc.) may have their own costs. Check the pricing page for whichever agent you use. Some agents (Gemini, Qwen) have free tiers. See `openacp agents list` for setup notes per agent.

---

### Can I use OpenACP without Telegram?

Yes. Telegram is the default adapter used in the quick-start guide, but it is not required. Discord and Slack adapters are built in. You can also build a custom adapter by implementing the `ChannelAdapter` abstract class. Disable Telegram entirely by setting `channels.telegram.enabled: false` in your config.

---

### How many concurrent sessions can I run?

This is controlled by `security.maxConcurrentSessions` in `~/.openacp/config.json`. The default is intentionally low to prevent resource exhaustion. Each session spawns one agent subprocess — increase the limit carefully based on available RAM and CPU.

```json
"security": {
  "maxConcurrentSessions": 5
}
```

---

### Does OpenACP work offline or with local models?

OpenACP works with any agent that implements the ACP protocol. If your agent uses a local model (e.g., via Ollama), it will work offline. Agents like Goose support local model providers out of the box. The OpenACP server itself does not need internet access — only the agent subprocess does (if it calls a remote API).

---

### How do I back up my sessions and configuration?

All persistent state is stored in `~/.openacp/`:
- `config.json` — your full configuration
- `sessions/` — session metadata and history

Back up the entire `~/.openacp/` directory. To restore on a new machine, copy it back and reinstall OpenACP (`npm install -g @openacp/cli`).

---

### Can multiple people use the same OpenACP instance?

OpenACP supports multiple users via the `security.allowedUserIds` setting. Add each user's platform-specific ID to the list:

```json
"security": {
  "allowedUserIds": ["123456789", "987654321"]
}
```

Each user gets their own session thread. Note that all sessions share the same agent configuration and working directory root — there is no per-user isolation of the filesystem.

---

### OpenACP crashed and left orphaned agent processes. How do I clean up?

When OpenACP exits uncleanly, agent subprocesses may continue running. Find and stop them:

```bash
# Find orphaned agent processes
ps aux | grep claude   # or codex, gemini, etc.

# Kill by PID
kill <pid>
```

On next startup, OpenACP will create fresh sessions. If a session record in `~/.openacp/sessions/` references an agent session that no longer exists, OpenACP will fall back to starting a new agent session automatically rather than crashing.

---

### How do I report a bug or request a feature?

Open an issue on the [OpenACP GitHub repository](https://github.com/OpenACP/OpenACP). Before filing, run `openacp doctor` and include its output. Enable debug logging with `OPENACP_DEBUG=true openacp start` and attach the relevant log section.
