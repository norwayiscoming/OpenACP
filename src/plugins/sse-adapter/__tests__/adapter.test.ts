import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SSEAdapter } from '../adapter.js';
import type { ConnectionManager } from '../connection-manager.js';
import type { EventBuffer } from '../event-buffer.js';
import type { OutgoingMessage, PermissionRequest, NotificationMessage } from '../../../core/types.js';

function createMockConnectionManager(): ConnectionManager {
  return {
    addConnection: vi.fn(),
    removeConnection: vi.fn(),
    getConnectionsBySession: vi.fn().mockReturnValue([]),
    broadcast: vi.fn(),
    disconnectByToken: vi.fn(),
    listConnections: vi.fn().mockReturnValue([]),
    cleanup: vi.fn(),
  } as unknown as ConnectionManager;
}

function createMockEventBuffer(): EventBuffer {
  return {
    push: vi.fn(),
    getSince: vi.fn().mockReturnValue([]),
    cleanup: vi.fn(),
  } as unknown as EventBuffer;
}

describe('SSEAdapter', () => {
  let adapter: SSEAdapter;
  let connMgr: ReturnType<typeof createMockConnectionManager>;
  let eventBuf: ReturnType<typeof createMockEventBuffer>;

  beforeEach(() => {
    vi.useFakeTimers();
    connMgr = createMockConnectionManager();
    eventBuf = createMockEventBuffer();
    adapter = new SSEAdapter(connMgr, eventBuf);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('properties', () => {
    it('has name "sse"', () => {
      expect(adapter.name).toBe('sse');
    });

    it('has correct capabilities', () => {
      expect(adapter.capabilities).toEqual({
        streaming: true,
        richFormatting: false,
        threads: true,
        reactions: false,
        fileUpload: false,
        voice: false,
      });
    });
  });

  describe('sendMessage', () => {
    it('serializes, buffers, and broadcasts message', async () => {
      const message: OutgoingMessage = { type: 'text', text: 'hello' };
      await adapter.sendMessage('sess-1', message);

      expect(eventBuf.push).toHaveBeenCalledOnce();
      expect(eventBuf.push).toHaveBeenCalledWith('sess-1', expect.objectContaining({
        id: expect.stringContaining('evt_'),
      }));

      expect(connMgr.broadcast).toHaveBeenCalledOnce();
      expect(connMgr.broadcast).toHaveBeenCalledWith('sess-1', expect.stringContaining('event: message'));
    });
  });

  describe('sendPermissionRequest', () => {
    it('serializes, buffers, and broadcasts permission request', async () => {
      const request: PermissionRequest = {
        id: 'perm-1',
        description: 'Allow file write?',
        options: [
          { id: 'allow', label: 'Allow', isAllow: true },
          { id: 'deny', label: 'Deny', isAllow: false },
        ],
      };
      await adapter.sendPermissionRequest('sess-1', request);

      expect(eventBuf.push).toHaveBeenCalledOnce();
      expect(connMgr.broadcast).toHaveBeenCalledOnce();
      expect(connMgr.broadcast).toHaveBeenCalledWith('sess-1', expect.stringContaining('permission_request'));
    });
  });

  describe('sendNotification', () => {
    it('broadcasts notification to session connections', async () => {
      const mockConn = { response: { writableEnded: false, write: vi.fn() } };
      (connMgr.getConnectionsBySession as any).mockReturnValue([mockConn]);

      const notification: NotificationMessage = {
        sessionId: 'sess-1',
        type: 'completed',
        summary: 'Session completed',
      };
      await adapter.sendNotification(notification);

      expect(connMgr.broadcast).toHaveBeenCalledOnce();
    });

    it('does nothing when no session connections exist', async () => {
      (connMgr.getConnectionsBySession as any).mockReturnValue([]);

      const notification: NotificationMessage = {
        sessionId: 'sess-1',
        type: 'error',
        summary: 'Something failed',
      };
      await adapter.sendNotification(notification);

      expect(connMgr.broadcast).not.toHaveBeenCalled();
    });
  });

  describe('createSessionThread', () => {
    it('returns sessionId as threadId', async () => {
      const threadId = await adapter.createSessionThread('sess-123', 'My Session');
      expect(threadId).toBe('sess-123');
    });
  });

  describe('renameSessionThread', () => {
    it('is a no-op', async () => {
      await expect(adapter.renameSessionThread('sess-1', 'New Name')).resolves.toBeUndefined();
    });
  });

  describe('start/stop lifecycle', () => {
    it('starts heartbeat on start and stops on stop', async () => {
      const mockConn = { response: { writableEnded: false, write: vi.fn() } };
      (connMgr.listConnections as any).mockReturnValue([mockConn]);

      await adapter.start();

      // Advance past heartbeat interval
      vi.advanceTimersByTime(30_000);
      expect(mockConn.response.write).toHaveBeenCalledWith(expect.stringContaining('heartbeat'));

      await adapter.stop();
      expect(connMgr.cleanup).toHaveBeenCalledOnce();

      // Verify heartbeat stopped
      mockConn.response.write.mockClear();
      vi.advanceTimersByTime(30_000);
      expect(mockConn.response.write).not.toHaveBeenCalled();
    });
  });
});
