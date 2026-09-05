import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Public-demo guard. Blocks the small set of mutations that would either let one
 * visitor disrupt others sharing the same seeded logins (disabling/reassigning a
 * demo account, revoking all its sessions) or turn the instance into an SSRF/exfil
 * vector (pointing an outbound webhook at an attacker-controlled URL). Everything
 * else — the actual inventory workflows the demo exists to show off — is untouched,
 * and nightly reseeding (see deploy/demo-reset.sh) cleans up whatever else changes.
 *
 * Paths are matched against the full request path INCLUDING the global "/api"
 * prefix, since Express middleware sees the raw incoming URL.
 */
const BLOCKED_IN_DEMO: ReadonlyArray<{ method: string; pattern: RegExp }> = [
  { method: 'POST', pattern: /^\/api\/users\/?$/ },
  { method: 'PATCH', pattern: /^\/api\/users\/[^/]+\/?$/ },
  { method: 'PATCH', pattern: /^\/api\/organizations\/current\/?$/ },
  { method: 'PUT', pattern: /^\/api\/notification-webhook\/?$/ },
  { method: 'PUT', pattern: /^\/api\/notification-webhook\/subscriptions\/?$/ },
  { method: 'POST', pattern: /^\/api\/auth\/logout-all\/?$/ },
];

export function demoModeMiddleware(enabled: boolean): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!enabled) return next();
    const path = req.path;
    const blocked = BLOCKED_IN_DEMO.some((r) => r.method === req.method && r.pattern.test(path));
    if (!blocked) return next();
    res.status(403).json({
      statusCode: 403,
      error: 'Demo Mode',
      message: 'Account and security settings are disabled on this public demo. Data resets nightly.',
      path,
      timestamp: new Date().toISOString(),
    });
  };
}
