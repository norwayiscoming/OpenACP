import type { OutgoingMessage, PermissionRequest, NotificationMessage, AgentCommand } from './types.js'

export interface ChannelConfig {
  enabled: boolean
  [key: string]: unknown
}

export interface AdapterCapabilities {
  streaming: boolean
  richFormatting: boolean
  threads: boolean
  reactions: boolean
  fileUpload: boolean
  voice: boolean
}

export interface IChannelAdapter {
  readonly name: string
  readonly capabilities: AdapterCapabilities

  start(): Promise<void>
  stop(): Promise<void>

  // Outgoing: core → channel
  sendMessage(sessionId: string, content: OutgoingMessage): Promise<void>
  sendPermissionRequest(sessionId: string, request: PermissionRequest): Promise<void>
  sendNotification(notification: NotificationMessage): Promise<void>

  // Session lifecycle on channel side
  createSessionThread(sessionId: string, name: string): Promise<string>  // returns threadId
  renameSessionThread(sessionId: string, newName: string): Promise<void>
  deleteSessionThread?(sessionId: string): Promise<void>
  archiveSessionTopic?(sessionId: string): Promise<void>

  // TTS strip — optional, called after TTS audio is synthesized to remove [TTS] block from text
  stripTTSBlock?(sessionId: string): Promise<void>

  // Skill commands — optional
  sendSkillCommands?(sessionId: string, commands: AgentCommand[]): Promise<void>
  cleanupSkillCommands?(sessionId: string): Promise<void>
  /** Flush skill commands that were queued before threadId was available */
  flushPendingSkillCommands?(sessionId: string): Promise<void>

  // Agent switch cleanup — optional, called when switching agents to clear adapter-side per-session state
  cleanupSessionState?(sessionId: string): Promise<void>
}

/**
 * Base class providing default no-op implementations for optional methods.
 * Adapters can extend this or implement IChannelAdapter directly.
 * @deprecated Use MessagingAdapter or StreamAdapter instead. Kept for backward compat during migration.
 */
export abstract class ChannelAdapter<TCore = unknown> implements IChannelAdapter {
  abstract readonly name: string
  readonly capabilities: AdapterCapabilities = {
    streaming: false, richFormatting: false, threads: false,
    reactions: false, fileUpload: false, voice: false,
  }

  constructor(public readonly core: TCore, protected config: ChannelConfig) {}

  abstract start(): Promise<void>
  abstract stop(): Promise<void>

  abstract sendMessage(sessionId: string, content: OutgoingMessage): Promise<void>
  abstract sendPermissionRequest(sessionId: string, request: PermissionRequest): Promise<void>
  abstract sendNotification(notification: NotificationMessage): Promise<void>

  abstract createSessionThread(sessionId: string, name: string): Promise<string>
  abstract renameSessionThread(sessionId: string, newName: string): Promise<void>
  async deleteSessionThread(_sessionId: string): Promise<void> {}

  async sendSkillCommands(_sessionId: string, _commands: AgentCommand[]): Promise<void> {}
  async cleanupSkillCommands(_sessionId: string): Promise<void> {}
  async cleanupSessionState(_sessionId: string): Promise<void> {}
  async archiveSessionTopic(_sessionId: string): Promise<void> {}
}
