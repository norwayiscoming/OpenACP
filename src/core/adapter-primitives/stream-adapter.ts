import type {
  IChannelAdapter,
  AdapterCapabilities,
} from '../channel.js'
import type {
  OutgoingMessage,
  PermissionRequest,
  NotificationMessage,
} from '../types.js'

export interface StreamEvent {
  type: string
  sessionId?: string
  payload: unknown
  timestamp: number
}

export abstract class StreamAdapter implements IChannelAdapter {
  abstract readonly name: string

  capabilities: AdapterCapabilities

  constructor(config?: Partial<AdapterCapabilities>) {
    this.capabilities = {
      streaming: true,
      richFormatting: false,
      threads: false,
      reactions: false,
      fileUpload: false,
      voice: false,
      ...config,
    }
  }

  async sendMessage(sessionId: string, content: OutgoingMessage): Promise<void> {
    await this.emit(sessionId, {
      type: content.type,
      sessionId,
      payload: content,
      timestamp: Date.now(),
    })
  }

  async sendPermissionRequest(sessionId: string, request: PermissionRequest): Promise<void> {
    await this.emit(sessionId, {
      type: 'permission_request',
      sessionId,
      payload: request,
      timestamp: Date.now(),
    })
  }

  async sendNotification(notification: NotificationMessage): Promise<void> {
    await this.broadcast({
      type: 'notification',
      payload: notification,
      timestamp: Date.now(),
    })
  }

  async createSessionThread(_sessionId: string, _name: string): Promise<string> {
    return ''
  }

  async renameSessionThread(sessionId: string, name: string): Promise<void> {
    await this.emit(sessionId, {
      type: 'session_rename',
      sessionId,
      payload: { name },
      timestamp: Date.now(),
    })
  }

  protected abstract emit(sessionId: string, event: StreamEvent): Promise<void>
  protected abstract broadcast(event: StreamEvent): Promise<void>
  abstract start(): Promise<void>
  abstract stop(): Promise<void>
}
