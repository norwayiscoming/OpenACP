# Workspaces

## What are workspaces?

When you first set up OpenACP, everything lives in one place: your bot tokens, agent settings, session history, and logs. This is your **main workspace** — it works great for most people.

But sometimes you need separate environments. Maybe you want:

- A **work** setup with one Telegram group and budget limits, and a **personal** setup with a different group and no limits.
- A **project-specific** setup that uses a different default agent or different permissions.
- A **testing** setup where you try out new plugins without breaking your main bot.

Workspaces let you run completely independent OpenACP setups on the same machine. Each workspace has its own settings, sessions, and data — they do not interfere with each other.

---

## Your main workspace

By default, OpenACP stores everything in a hidden folder called `~/.openacp/`. This is your main (global) workspace. When you run `openacp start` or any other command, this is the workspace that gets used.

You do not need to do anything special to use the main workspace. It is set up automatically the first time you run OpenACP.

---

## Creating a project workspace

If you want a separate workspace for a specific project, navigate to that project's folder and create a local workspace:

```bash
cd ~/my-project
openacp start --local
```

OpenACP creates a `.openacp/` folder inside your project directory and launches the setup wizard. From now on, whenever you run `openacp` from inside `~/my-project`, it automatically uses this project workspace instead of the main one.

You can also copy settings from your main workspace so you do not have to set up everything from scratch:

```bash
cd ~/my-project
openacp start --local --from ~/.openacp
```

This copies your existing settings but asks you to confirm sensitive values like bot tokens (since a different Telegram group or Discord server might be needed).

---

## Switching between workspaces

OpenACP automatically picks the right workspace based on where you run the command:

- **Inside a project folder** with `.openacp/` — uses the project workspace.
- **Anywhere else** — uses your main workspace.

If you want to be explicit:

```bash
openacp start --local    # force the project workspace (current folder)
openacp start --global   # force the main workspace
```

---

## Seeing all your workspaces

To check which workspaces exist and whether they are running:

```bash
openacp status --all
```

This shows every workspace with its name, location, and whether a bot is currently running.

---

## How workspaces stay separate

Each workspace runs independently:

- **Separate settings** — each workspace has its own `config.json`. Changing the agent in one workspace does not affect the other.
- **Separate sessions** — conversations in the work workspace are not visible in the personal workspace.
- **Separate bots** — each workspace can connect to a different Telegram group or Discord server, or even use different bot tokens entirely.
- **Separate ports** — if both workspaces are running simultaneously, they automatically use different network ports so there are no conflicts.

---

## When do you need multiple workspaces?

Most users only need the main workspace. Consider adding a project workspace when:

- You want a **completely different bot configuration** for a project (different group, different agents, different budget).
- You are **developing or testing plugins** and do not want to risk your main setup.
- You manage **multiple teams** that each need their own isolated OpenACP environment.

If you just want to switch between different agents or projects within the same bot, you do not need a new workspace — use sessions and the `/new` command instead.
