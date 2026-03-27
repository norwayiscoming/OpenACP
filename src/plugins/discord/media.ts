import type { Attachment } from '../../core/types.js'
import { log } from '../../core/utils/log.js'

const MAX_DOWNLOAD_SIZE = 100 * 1024 * 1024 // 100MB safety cap for downloads
const DISCORD_UPLOAD_LIMIT = 25 * 1024 * 1024 // 25MB — Discord free tier

/**
 * Check if an attachment exceeds Discord's upload limit.
 */
export function isAttachmentTooLarge(size: number): boolean {
  return size > DISCORD_UPLOAD_LIMIT
}

/**
 * Classify a MIME contentType string into an Attachment type.
 */
export function classifyAttachmentType(
  contentType: string | null | undefined,
): Attachment['type'] {
  if (!contentType) return 'file'
  if (contentType.startsWith('image/')) return 'image'
  if (contentType.startsWith('audio/')) return 'audio'
  return 'file'
}

/**
 * Build fallback text when message.content is empty but attachments exist.
 * Mirrors Telegram adapter's pattern: [Photo: filename], [Audio: filename], [File: filename]
 */
export function buildFallbackText(
  attachments: Array<{ type: Attachment['type']; fileName: string }>,
): string {
  return attachments
    .map((att) => {
      const label = att.type === 'image' ? 'Photo' : att.type === 'audio' ? 'Audio' : 'File'
      return `[${label}: ${att.fileName}]`
    })
    .join(' ')
}

/**
 * Download a file from a Discord attachment URL.
 * Returns the buffer or null on failure.
 */
export async function downloadDiscordAttachment(
  url: string,
  fileName: string,
): Promise<Buffer | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) {
      log.warn({ url, status: response.status, fileName }, '[discord-media] Download failed')
      return null
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > MAX_DOWNLOAD_SIZE) {
      log.warn({ fileName, size: buffer.length }, '[discord-media] File exceeds download size cap')
      return null
    }
    return buffer
  } catch (err) {
    log.error({ err, url, fileName }, '[discord-media] Download error')
    return null
  }
}
