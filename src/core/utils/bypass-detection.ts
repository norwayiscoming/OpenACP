/** Keywords that indicate a permission-bypass (auto-approve) value.
 * NOTE: "dontask"/"dont_ask"/"skip" are NOT bypass — they DENY unknown permissions. */
export const BYPASS_KEYWORDS = ['bypass', 'dangerous', 'auto_accept']

/** Returns true if the given value string contains a bypass keyword (case-insensitive) */
export function isPermissionBypass(value: string): boolean {
  const lower = value.toLowerCase()
  return BYPASS_KEYWORDS.some(kw => lower.includes(kw))
}
