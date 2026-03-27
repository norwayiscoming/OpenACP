import fs from "node:fs";

/**
 * Read a text file, optionally returning only a range of lines.
 * Pure utility — no dependencies on plugin code.
 */
export async function readTextFileWithRange(
  filePath: string,
  options?: { line?: number; limit?: number },
): Promise<string> {
  const content = await fs.promises.readFile(filePath, "utf-8");
  if (!options?.line && !options?.limit) return content;
  const lines = content.split("\n");
  const start = Math.max(0, (options.line ?? 1) - 1);
  const end = options.limit ? start + options.limit : lines.length;
  return lines.slice(start, end).join("\n");
}
