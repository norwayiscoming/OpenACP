export function progressBar(ratio: number, length = 10): string {
  const filled = Math.round(Math.min(ratio, 1) * length);
  return "▓".repeat(filled) + "░".repeat(length - filled);
}

export function formatTokens(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

export function stripCodeFences(text: string): string {
  return text
    .replace(/```\w*\n?/g, "")
    .replace(/```$/gm, "")
    .trim();
}

export function truncateContent(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "\n… (truncated)";
}

export function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    const wouldLeaveSmall = remaining.length < maxLength * 1.3;
    const searchLimit = wouldLeaveSmall
      ? Math.floor(remaining.length / 2) + 300
      : maxLength;

    const threshold = maxLength * 0.2;
    let splitAt = remaining.lastIndexOf("\n\n", searchLimit);
    if (splitAt === -1 || splitAt < threshold) {
      splitAt = remaining.lastIndexOf("\n", searchLimit);
    }
    if (splitAt === -1 || splitAt < threshold) {
      splitAt = searchLimit;
    }

    const candidate = remaining.slice(0, splitAt);
    const fences = candidate.match(/```/g);
    if (fences && fences.length % 2 !== 0) {
      const closingFence = remaining.indexOf("```", splitAt);
      if (closingFence !== -1) {
        const afterFence = remaining.indexOf("\n", closingFence + 3);
        const fenceSplit =
          afterFence !== -1 ? afterFence + 1 : closingFence + 3;
        // Only extend to include the closing fence if it doesn't exceed 2x maxLength
        if (fenceSplit <= maxLength * 2) {
          splitAt = fenceSplit;
        }
      }
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n+/, "");
  }
  return chunks;
}
