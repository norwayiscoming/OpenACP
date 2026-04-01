import * as clack from "@clack/prompts";
import { guardCancel, step } from "./helpers.js";

export async function setupWorkspace(opts?: {
  existing?: string;
  stepNum?: number;
  totalSteps?: number;
  isGlobal?: boolean;
}): Promise<{ baseDir: string }> {
  const { existing, stepNum, totalSteps, isGlobal } = opts ?? {};
  if (stepNum != null && totalSteps != null) {
    console.log(step(stepNum, totalSteps, "Workspace"));
  }

  const defaultDir = isGlobal === false ? process.cwd() : "~/openacp-workspace";

  const baseDir = guardCancel(
    await clack.text({
      message: "Base directory for agent workspaces:",
      initialValue: existing ?? defaultDir,
      validate: (val) =>
        (val ?? "").toString().trim().length > 0 ? undefined : "Path cannot be empty",
    }),
  ) as string;

  return { baseDir: baseDir.trim().replace(/^['"]|['"]$/g, "") };
}
