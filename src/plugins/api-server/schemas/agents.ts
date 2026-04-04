import { z } from 'zod';

export const AgentResponseSchema = z.object({
  name: z.string(),
  command: z.string(),
  args: z.array(z.string()).optional(),
  workingDirectory: z.string().optional(),
});
