import { z } from 'zod';

export const ListSessionsQuerySchema = z.object({
  status: z.enum(['initializing', 'active', 'finished', 'cancelled', 'error']).optional(),
  agentName: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// Workspace names must be relative (no leading / or ~) to prevent path injection.
// Absolute paths would let an authenticated caller point the AI agent at sensitive
// system directories (e.g. workspace: "/").  Relative names are resolved by
// ConfigManager.resolveWorkspace() into the configured base directory.
const WorkspaceNameSchema = z.string().optional().refine(
  (v) => v === undefined || (!v.startsWith('/') && !v.startsWith('~')),
  { message: 'workspace must be a relative name, not an absolute path' },
);

export const CreateSessionBodySchema = z.object({
  agent: z.string().max(200).optional(),
  workspace: WorkspaceNameSchema,
  channel: z.string().max(200).optional(),
});

export const AdoptSessionBodySchema = z.object({
  agent: z.string().min(1).max(200),
  agentSessionId: z.string().min(1).max(200),
  // cwd for adopt is the existing agent's working directory — absolute paths are valid here
  // since the agent is already running at that location.
  cwd: z.string().max(500).optional(),
  channel: z.string().max(200).optional(),
});

export const PromptBodySchema = z.object({
  // 100 KB limit — prevents memory exhaustion / DoS via enormous payloads
  prompt: z.string().min(1).max(100_000),
  // Multi-adapter routing fields
  sourceAdapterId: z.string().optional(),
  responseAdapterId: z.string().nullable().optional(),
});

export const PermissionResponseBodySchema = z.object({
  permissionId: z.string().min(1).max(200),
  optionId: z.string().min(1).max(200),
});

export const DangerousModeBodySchema = z.object({
  enabled: z.boolean(),
});

export const UpdateSessionBodySchema = z.object({
  agentName: z.string().min(1).max(200).optional(),
  voiceMode: z.enum(['off', 'next', 'on']).optional(),
  dangerousMode: z.boolean().optional(),
});

export const SessionIdParamSchema = z.object({
  sessionId: z.string().min(1).max(200),
});

export const ConfigIdParamSchema = z.object({
  sessionId: z.string().min(1).max(200),
  configId: z.string().min(1).max(200),
});

export const SetConfigOptionBodySchema = z.object({
  value: z.string().max(1_000),
});

export const SetClientOverridesBodySchema = z.object({
  bypassPermissions: z.boolean().optional(),
});
