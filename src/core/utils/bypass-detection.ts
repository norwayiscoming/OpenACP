/** Keywords that indicate a permission-bypass value */
export const BYPASS_KEYWORDS = ['bypass', 'dangerous', 'skip', 'dontask', 'dont_ask', 'auto_accept']

/** Returns true if the given value string contains a bypass keyword (case-insensitive) */
export function isPermissionBypass(value: string): boolean {
  const lower = value.toLowerCase()
  return BYPASS_KEYWORDS.some(kw => lower.includes(kw))
}
