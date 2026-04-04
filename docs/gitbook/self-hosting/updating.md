# Updating

## Check Your Current Version

```bash
openacp --version
```

This prints the version from the installed package (e.g., `2026.401.1`). The version is read from `package.json` bundled with the binary.

OpenACP also checks for updates automatically at startup. If a newer version is available on npm, you are prompted:

```
Update available: 2026.327.1 → 2026.401.1
? Update now before starting?
```

Selecting yes runs `npm install -g @openacp/cli@latest` in-process and exits, asking you to re-run your command with the new version. Set `OPENACP_SKIP_UPDATE_CHECK=true` to suppress this prompt.

## Update

```bash
npm update -g @openacp/cli
```

Or to pin to a specific version:

```bash
npm install -g @openacp/cli@2026.401.1
```

If you are running from source, pull and rebuild:

```bash
git pull
pnpm install
pnpm build
```

## Backward Compatibility Guarantee

OpenACP guarantees that existing `~/.openacp/config.json` files, session data, and stored state continue to work after any minor or patch upgrade without manual intervention.

Specific commitments:

- **Config schema**: New fields always have `.default()` or `.optional()` in the Zod schema. An older config file will never fail validation after an upgrade.
- **CLI commands and flags**: Existing commands and flags are never removed or renamed in a minor/patch release. Deprecated commands are kept operational with a warning until the next major version.
- **Plugin API**: Plugin-facing interfaces maintain backward compatibility within a major version.
- **Data files**: All files under `~/.openacp/` (sessions, topics, state) are handled defensively — unknown fields are preserved and old formats are migrated automatically.

## Automatic Config Migrations

When OpenACP starts, it runs all pending config migrations before validation. Migrations are applied to the raw JSON in memory and written back to disk if any change was made. You do not need to edit the file manually after an upgrade.

Current migrations (run in order):

1. **`add-tunnel-section`** — Adds the `tunnel` block with Cloudflare defaults if the key is absent.
2. **`fix-agent-commands`** — Renames legacy agent command values to their current names.
3. **`migrate-agents-to-store`** — Moves agent definitions from `config.json` into the separate `~/.openacp/agents.json` store introduced in a later release.

Migrations are idempotent: running them multiple times has no effect.

## Post-Upgrade Checks

After upgrading, start OpenACP normally:

```bash
openacp start
```

If there are any issues with the config (e.g., a field that could not be migrated), the process prints the validation errors and exits with a non-zero code. Review the output and correct the config file at `~/.openacp/config.json`.

For plugin adapters installed under `~/.openacp/plugins/`, re-install them after a major upgrade to ensure API compatibility:

```bash
openacp install @openacp/adapter-discord
```
