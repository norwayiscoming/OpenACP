# API Reference

Complete reference for CLI commands, REST API, configuration schema, and environment variables.

| Section | Contents |
|---|---|
| [CLI Commands](cli-commands.md) | Every `openacp` subcommand: usage, options, examples |
| [REST API](rest-api.md) | HTTP endpoints exposed by the local API server |
| [Configuration Schema](configuration-schema.md) | Full `~/.openacp/config.json` field reference |
| [Environment Variables](environment-variables.md) | `OPENACP_*` env vars and their config equivalents |

The REST API listens on `http://127.0.0.1:21420` by default (configurable via `api.port` / `api.host`). All authenticated endpoints require a Bearer token read from `~/.openacp/api-secret`. The CLI reads this file automatically; external clients must read it explicitly.
