import { z } from 'zod';

export const UpdateConfigBodySchema = z.object({
  path: z.string().min(1),
  value: z.unknown(),
});
