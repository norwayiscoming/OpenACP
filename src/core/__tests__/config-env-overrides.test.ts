import { describe, it, expect, afterEach } from "vitest";
import { ConfigManager } from "../config.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("Config env var overrides — Slack", () => {
  const tmpDir = path.join(os.tmpdir(), `openacp-test-${Date.now()}`);
  const configPath = path.join(tmpDir, "config.json");

  afterEach(() => {
    delete process.env.OPENACP_SLACK_BOT_TOKEN;
    delete process.env.OPENACP_SLACK_APP_TOKEN;
    delete process.env.OPENACP_SLACK_SIGNING_SECRET;
    delete process.env.OPENACP_CONFIG_PATH;
    try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  });

  it("OPENACP_SLACK_BOT_TOKEN overrides channels.slack.botToken", async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      channels: { slack: { enabled: true, botToken: "old-token" } },
      agents: {},
      defaultAgent: "claude",
    }));

    process.env.OPENACP_SLACK_BOT_TOKEN = "xoxb-env-override";
    process.env.OPENACP_CONFIG_PATH = configPath;

    const mgr = new ConfigManager();
    await mgr.load();
    const config = mgr.get();
    expect((config.channels as any).slack.botToken).toBe("xoxb-env-override");
  });

  it("OPENACP_SLACK_APP_TOKEN overrides channels.slack.appToken", async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      channels: { slack: { enabled: true, appToken: "old-app-token" } },
      agents: {},
      defaultAgent: "claude",
    }));

    process.env.OPENACP_SLACK_APP_TOKEN = "xapp-1-env-override";
    process.env.OPENACP_CONFIG_PATH = configPath;

    const mgr = new ConfigManager();
    await mgr.load();
    const config = mgr.get();
    expect((config.channels as any).slack.appToken).toBe("xapp-1-env-override");
  });

  it("OPENACP_SLACK_SIGNING_SECRET overrides channels.slack.signingSecret", async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      channels: { slack: { enabled: true, signingSecret: "old-secret" } },
      agents: {},
      defaultAgent: "claude",
    }));

    process.env.OPENACP_SLACK_SIGNING_SECRET = "new-secret-from-env";
    process.env.OPENACP_CONFIG_PATH = configPath;

    const mgr = new ConfigManager();
    await mgr.load();
    const config = mgr.get();
    expect((config.channels as any).slack.signingSecret).toBe("new-secret-from-env");
  });

  it("creates channels.slack path if it doesn't exist in config", async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      channels: {},
      agents: {},
      defaultAgent: "claude",
    }));

    process.env.OPENACP_SLACK_BOT_TOKEN = "xoxb-new";
    process.env.OPENACP_CONFIG_PATH = configPath;

    const mgr = new ConfigManager();
    await mgr.load();
    const config = mgr.get();
    expect((config.channels as any).slack.botToken).toBe("xoxb-new");
  });
});
