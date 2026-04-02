import { z } from 'zod';

export const ListSessionsQuerySchema = z.object({
  status: z.enum(['initializing', 'active', 'finished', 'cancelled', 'error']).optional(),
  agentName: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const CreateSessionBodySchema = z.object({
  agent: z.string().optional(),
  workspace: z.string().optional(),
  channel: z.string().optional(),
});

export const AdoptSessionBodySchema = z.object({
  agent: z.string().min(1),
  agentSessionId: z.string().min(1),
  cwd: z.string().optional(),
  channel: z.string().optional(),
});

export const PromptBodySchema = z.object({
  prompt: z.string().min(1),
});

export const PermissionResponseBodySchema = z.object({
  permissionId: z.string().min(1),
  optionId: z.string().min(1),
});

export const DangerousModeBodySchema = z.object({
  enabled: z.boolean(),
});

export const UpdateSessionBodySchema = z.object({
  agentName: z.string().min(1).optional(),
  voiceMode: z.enum(['off', 'next', 'on']).optional(),
  dangerousMode: z.boolean().optional(),
});

export const SessionIdParamSchema = z.object({
  sessionId: z.string().min(1),
});

export const ConfigIdParamSchema = z.object({
  sessionId: z.string().min(1),
  configId: z.string().min(1),
});

export const SetConfigOptionBodySchema = z.object({
  value: z.string(),
});

export const SetClientOverridesBodySchema = z.object({
  bypassPermissions: z.boolean().optional(),
});
