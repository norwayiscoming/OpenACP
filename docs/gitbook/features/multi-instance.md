# Workspaces

## What are workspaces?

A **workspace** is a directory on your machine that contains an OpenACP instance. Every instance lives inside its workspace as `<workspace>/.openacp/`. The workspace directory is also what AI agents use as their working root.

Workspaces let you run completely independent OpenACP setups on the same machine. Each workspace has its own settings, sessions, and data — they do not interfere with each other.

You might want multiple workspaces when you need:

- A **work** setup with one Telegram group and budget limits, and a **personal** setup with a different group and no limits.
- A **project-specific** setup that uses a different default agent or different permissions.
- A **testing** setup where you try out new plugins without breaking your main bot.

---

## Directory structure

Each workspace follows this layout:

```
<workspace>/
  .openacp/           ← instance data (config, sessions, plugins, logs, etc.)
  ...                 ← your project files (agents work here)
```

A lightweight shared store at `~/.openacp/` holds data shared across all instances (agent binaries, the instance registry, CLI tools). It is **not** an instance itself.

```
~/.openacp/
  instances.json      ← registry: maps instance ID → workspace path
  agents/             ← shared agent binaries
  bin/                ← shared CLI tools
  cache/              ← ACP Registry cache
```

---

## Creating your first workspace

Run `openacp` (no arguments) from the directory you want to use as your workspace. If no instance is found, the setup wizard launches:

```bash
cd ~/openacp-workspace
openacp
```

The wizard creates `~/openacp-workspace/.openacp/`, writes your config, and registers the instance.

You can also use the non-interactive setup command:

```bash
openacp setup --dir ~/my-project --agent claude
```

---

## Creating additional workspaces

Navigate to the new workspace directory and run the setup wizard:

```bash
cd ~/work-project
openacp
```

Or non-interactively:

```bash
openacp setup --dir ~/work-project --agent claude
```

You can copy structure from an existing instance so you don't have to reinstall plugins and agents from scratch:

```bash
openacp instances create --dir ~/work-project --from ~/openacp-workspace
```

This copies your installed plugins, plugin packages, and agent definitions — but **not** credentials or sensitive settings (bot tokens, API keys, channel IDs). After cloning, run `openacp config` or `openacp onboard` in the new workspace to enter your credentials for the new instance.

---

## Switching between workspaces

OpenACP automatically resolves the active instance based on where you run the command:

- **Inside a workspace directory** (or any subdirectory) with `.openacp/config.json` → uses that instance automatically.
- **Anywhere else** → prompts you to select from registered instances.

To be explicit about which instance to use:

```bash
openacp start --dir ~/my-project           # use instance at ~/my-project
openacp start --local                      # use instance in the current directory
```

After resolution, the CLI prints a hint so you always know which instance is active:

```
Using: my-project (~/my-project/.openacp)
```

---

## Listing all instances

```bash
openacp instances list
```

This shows every registered instance with its name, directory, and running status.

---

## How workspaces stay separate

Each instance runs independently:

- **Separate settings** — each instance has its own `config.json`. Changing the agent in one instance does not affect the other.
- **Separate sessions** — conversations in one instance are not visible in another.
- **Separate bots** — each instance can connect to a different Telegram group or Discord server, or use different bot tokens.
- **Separate ports** — if multiple instances are running simultaneously, they use different network ports automatically.

---

## When do you need multiple workspaces?

Most users only need one workspace. Consider adding another when:

- You want a **completely different bot configuration** for a project (different group, different agents, different budget).
- You are **developing or testing plugins** and do not want to risk your main setup.
- You manage **multiple teams** that each need their own isolated OpenACP environment.

If you just want to switch between different agents or projects within the same bot, you do not need a new workspace — use sessions and the `/new` command instead.
