export const APPLICATION_NAME = "ilvox-backend";
export const APPLICATION_VERSION = "0.1.0";
export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 3000;
export const DEFAULT_BODY_LIMIT_BYTES = 1_048_576;
export const DEFAULT_RATE_LIMIT_MAX = 100;
export const DEFAULT_RATE_LIMIT_WINDOW = "1 minute";

export const SENSITIVE_LOG_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.body.password",
  "req.body.token",
  "req.body.secret",
  "req.headers.svix-signature",
  "req.headers.webhook-signature",
  "req.headers.svix-timestamp",
  "req.headers.webhook-timestamp",
  "res.headers['set-cookie']",
] as const;
