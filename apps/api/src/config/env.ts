import { z } from 'zod';

/** Validated environment schema. The app refuses to boot on invalid config. */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.string().url(),
    JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
    // Access token is short-lived; the refresh token carries longevity (rotated on every use).
    JWT_EXPIRES_IN: z.string().default('15m'),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().max(365).default(30),
    // Comma-separated allowlist of browser origins for CORS.
    CORS_ORIGIN: z.string().default('http://localhost:3000'),
    // Multiplier for the in-memory rate limiter (1 = default limits; raise for load tests).
    RATE_LIMIT_FACTOR: z.coerce.number().positive().default(1),
  })
  .superRefine((env, ctx) => {
    // Production must not run on a weak or default secret.
    if (env.NODE_ENV === 'production') {
      if (env.JWT_SECRET.length < 32) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['JWT_SECRET'], message: 'must be at least 32 characters in production' });
      }
      if (/^(dev|test|secret|changeme|password)/i.test(env.JWT_SECRET)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['JWT_SECRET'], message: 'looks like a default/placeholder secret' });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
