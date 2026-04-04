import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigManager } from '../config.js';

describe('applyEnvToPluginSettings', () => {
  const mockSettingsManager = () => ({
    updatePluginSettings: vi.fn().mockResolvedValue(undefined),
    loadSettings: vi.fn().mockResolvedValue({}),
  });

  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    originalEnv = {};
    for (const key of [
      'OPENACP_TUNNEL_ENABLED', 'OPENACP_TUNNEL_PORT', 'OPENACP_TUNNEL_PROVIDER',
      'OPENACP_API_PORT', 'OPENACP_SPEECH_STT_PROVIDER', 'OPENACP_SPEECH_GROQ_API_KEY',
      'OPENACP_TELEGRAM_BOT_TOKEN', 'OPENACP_TELEGRAM_CHAT_ID',
    ]) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('writes tunnel env vars to tunnel plugin settings', async () => {
    process.env.OPENACP_TUNNEL_ENABLED = 'false';
    process.env.OPENACP_TUNNEL_PROVIDER = 'ngrok';

    const sm = mockSettingsManager();
    const cm = new ConfigManager('/tmp/nonexistent-config.json');
    await cm.applyEnvToPluginSettings(sm as any);

    expect(sm.updatePluginSettings).toHaveBeenCalledWith(
      '@openacp/tunnel',
      { enabled: false },
    );
    expect(sm.updatePluginSettings).toHaveBeenCalledWith(
      '@openacp/tunnel',
      { provider: 'ngrok' },
    );
  });

  it('transforms string to number for port env vars', async () => {
    process.env.OPENACP_API_PORT = '8080';

    const sm = mockSettingsManager();
    const cm = new ConfigManager('/tmp/nonexistent-config.json');
    await cm.applyEnvToPluginSettings(sm as any);

    expect(sm.updatePluginSettings).toHaveBeenCalledWith(
      '@openacp/api-server',
      { port: 8080 },
    );
  });

  it('does not write when env var is not set', async () => {
    const sm = mockSettingsManager();
    const cm = new ConfigManager('/tmp/nonexistent-config.json');
    await cm.applyEnvToPluginSettings(sm as any);

    expect(sm.updatePluginSettings).not.toHaveBeenCalled();
  });

  it('writes telegram env vars with correct transforms', async () => {
    process.env.OPENACP_TELEGRAM_BOT_TOKEN = 'my-token';
    process.env.OPENACP_TELEGRAM_CHAT_ID = '-1001234';

    const sm = mockSettingsManager();
    const cm = new ConfigManager('/tmp/nonexistent-config.json');
    await cm.applyEnvToPluginSettings(sm as any);

    expect(sm.updatePluginSettings).toHaveBeenCalledWith(
      '@openacp/telegram',
      { botToken: 'my-token' },
    );
    expect(sm.updatePluginSettings).toHaveBeenCalledWith(
      '@openacp/telegram',
      { chatId: -1001234 },
    );
  });
});
