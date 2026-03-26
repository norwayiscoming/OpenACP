import * as clack from "@clack/prompts";
import { guardCancel, step } from "./helpers.js";

export async function setupWorkspace(opts?: {
  existing?: string;
  stepNum?: number;
  totalSteps?: number;
}): Promise<{ baseDir: string }> {
  const { existing, stepNum, totalSteps } = opts ?? {};
  if (stepNum != null && totalSteps != null) {
    console.log(step(stepNum, totalSteps, "Workspace"));
  }

  const baseDir = guardCancel(
    await clack.text({
      message: "Base directory for workspaces:",
      initialValue: existing ?? "~/openacp-workspace",
      validate: (val) =>
        (val ?? "").toString().trim().length > 0 ? undefined : "Path cannot be empty",
    }),
  ) as string;

  return { baseDir: baseDir.trim().replace(/^['"]|['"]$/g, "") };
}
