import { describe, it, expect, vi } from 'vitest';
import {
  getFieldDef,
  getFieldValueAsync,
  setFieldValueAsync,
  CONFIG_REGISTRY,
} from '../config-registry.js';

describe('ConfigFieldDef plugin mapping', () => {
  it('plugin-mapped fields have plugin.name and plugin.key', () => {
    const secField = getFieldDef('security.maxConcurrentSessions')!;
    expect(secField).toBeDefined();
    expect(secField.plugin).toEqual({
      name: '@openacp/security',
      key: 'maxConcurrentSessions',
    });
  });

  it('non-plugin fields have no plugin mapping', () => {
    const logField = getFieldDef('logging.level')!;
    expect(logField.plugin).toBeUndefined();
  });

  it('all plugin mappings reference valid registry entries', () => {
    const mapped = CONFIG_REGISTRY.filter((f) => f.plugin);
    expect(mapped.length).toBeGreaterThan(0);
    for (const f of mapped) {
      expect(f.plugin!.name).toMatch(/^@openacp\//);
      expect(f.plugin!.key).toBeTruthy();
    }
  });
});

describe('getFieldValueAsync', () => {
  const mockSettings = (data: Record<string, unknown>) => ({
    loadSettings: vi.fn().mockResolvedValue(data),
  });
  const mockConfig = (data: Record<string, unknown>) => ({
    get: () => data,
  });

  it('reads from plugin settings when mapping exists and settingsManager provided', async () => {
    const field = getFieldDef('security.maxConcurrentSessions')!;
    const sm = mockSettings({ maxConcurrentSessions: 42 });
    const cm = mockConfig({ security: { maxConcurrentSessions: 20 } });

    const value = await getFieldValueAsync(field, cm as any, sm as any);
    expect(value).toBe(42);
    expect(sm.loadSettings).toHaveBeenCalledWith('@openacp/security');
  });

  it('falls back to config.json when settingsManager is undefined', async () => {
    const field = getFieldDef('security.maxConcurrentSessions')!;
    const cm = mockConfig({ security: { maxConcurrentSessions: 20 } });

    const value = await getFieldValueAsync(field, cm as any, undefined);
    expect(value).toBe(20);
  });

  it('returns undefined when plugin settings key is missing', async () => {
    const field = getFieldDef('security.maxConcurrentSessions')!;
    const sm = mockSettings({});
    const cm = mockConfig({ security: { maxConcurrentSessions: 20 } });

    const value = await getFieldValueAsync(field, cm as any, sm as any);
    expect(value).toBeUndefined();
  });

  it('reads from config.json for non-plugin fields even with settingsManager', async () => {
    const field = getFieldDef('logging.level')!;
    const sm = mockSettings({});
    const cm = mockConfig({ logging: { level: 'debug' } });

    const value = await getFieldValueAsync(field, cm as any, sm as any);
    expect(value).toBe('debug');
    expect(sm.loadSettings).not.toHaveBeenCalled();
  });
});

describe('setFieldValueAsync', () => {
  it('writes to plugin settings when mapping exists', async () => {
    const field = getFieldDef('security.maxConcurrentSessions')!;
    const sm = { updatePluginSettings: vi.fn().mockResolvedValue(undefined) };
    const cm = { setPath: vi.fn() };

    const result = await setFieldValueAsync(field, 50, cm as any, sm as any);
    expect(sm.updatePluginSettings).toHaveBeenCalledWith(
      '@openacp/security',
      { maxConcurrentSessions: 50 },
    );
    expect(cm.setPath).not.toHaveBeenCalled();
    expect(result.needsRestart).toBe(!field.hotReload);
  });

  it('writes to config.json for non-plugin fields', async () => {
    const field = getFieldDef('logging.level')!;
    const sm = { updatePluginSettings: vi.fn() };
    const cm = { setPath: vi.fn().mockResolvedValue(undefined) };

    await setFieldValueAsync(field, 'warn', cm as any, sm as any);
    expect(cm.setPath).toHaveBeenCalledWith('logging.level', 'warn');
    expect(sm.updatePluginSettings).not.toHaveBeenCalled();
  });

  it('falls back to config.json when no settingsManager (plugin field)', async () => {
    const field = getFieldDef('security.maxConcurrentSessions')!;
    const cm = { setPath: vi.fn().mockResolvedValue(undefined) };

    await setFieldValueAsync(field, 50, cm as any, undefined);
    expect(cm.setPath).toHaveBeenCalledWith('security.maxConcurrentSessions', 50);
  });

  it('propagates errors from updatePluginSettings', async () => {
    const field = getFieldDef('security.maxConcurrentSessions')!;
    const sm = {
      updatePluginSettings: vi.fn().mockRejectedValue(new Error('disk full')),
    };
    const cm = { setPath: vi.fn() };

    await expect(setFieldValueAsync(field, 50, cm as any, sm as any))
      .rejects.toThrow('disk full');
  });
});
