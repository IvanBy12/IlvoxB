import { z } from "zod";
import { AppError } from "../common/errors/app-error.js";
import { ErrorCode } from "../common/errors/error-codes.js";
import {
  DEFAULT_BODY_LIMIT_BYTES,
  DEFAULT_HOST,
  DEFAULT_PORT,
  DEFAULT_RATE_LIMIT_MAX,
  DEFAULT_RATE_LIMIT_WINDOW,
} from "./constants.js";

const optionalUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.url().optional(),
);

const optionalString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().min(1).optional(),
);

const optionalCsvUrls = z.string().default("").transform((value, context) => {
  const values = value.split(",").map((item) => item.trim()).filter(Boolean);
  for (const item of values) {
    if (!z.url().safeParse(item).success) {
      context.addIssue({ code: "custom", message: `Invalid URL: ${item}` });
    }
  }
  return values;
});

const optionalCsv = z.string().default("").transform((value) =>
  value.split(",").map((item) => item.trim()).filter(Boolean));

const optionalCsvEmails = z.string().default("").transform((value, context) => {
  const values = value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  for (const item of values) {
    if (!z.email().safeParse(item).success) {
      context.addIssue({ code: "custom", message: `Invalid email: ${item}` });
    }
  }
  return [...new Set(values)];
});

const emailFrom = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().max(320).refine(
    (value) => !/[\r\n]/u.test(value) && (
      z.email().safeParse(value).success ||
      /^[^<>]+<[^<>]+>$/u.test(value) && z.email().safeParse(value.slice(value.lastIndexOf("<") + 1, -1).trim()).success
    ),
    "EMAIL_FROM must be an email or a display name followed by <email>",
  ).optional(),
);

const booleanString = z
  .enum(["true", "false", "1", "0"])
  .default("false")
  .transform((value) => value === "true" || value === "1");

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    HOST: z.string().min(1).default(DEFAULT_HOST),
    PORT: z.coerce.number().int().min(1).max(65_535).default(DEFAULT_PORT),
    LOG_LEVEL: z
      .enum(["silent", "fatal", "error", "warn", "info", "debug", "trace"])
      .default("info"),
    TRUST_PROXY: booleanString,
    CORS_ORIGINS: z
      .string()
      .default("http://127.0.0.1:5173")
      .transform((value) => value.split(",").map((origin) => origin.trim()).filter(Boolean))
      .pipe(z.array(z.url()).min(1)),
    BODY_LIMIT_BYTES: z.coerce
      .number()
      .int()
      .min(1_024)
      .max(26_214_400)
      .default(DEFAULT_BODY_LIMIT_BYTES),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100_000).default(DEFAULT_RATE_LIMIT_MAX),
    RATE_LIMIT_WINDOW: z.string().min(1).default(DEFAULT_RATE_LIMIT_WINDOW),
    DATABASE_URL: optionalUrl,
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    DATABASE_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(30_000),
    DATABASE_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(100).default(5_000),
    CLERK_AUTH_ENABLED: booleanString,
    CLERK_WEBHOOKS_ENABLED: booleanString,
    CLERK_PUBLISHABLE_KEY: optionalString,
    CLERK_SECRET_KEY: optionalString,
    CLERK_WEBHOOK_SIGNING_SECRET: optionalString,
    CLERK_AUTHORIZED_PARTIES: optionalCsvUrls,
    CLERK_AUDIENCE: optionalCsv,
    CLIENT_APP_URL: optionalUrl,
    EMAIL_PROVIDER: z.enum(["disabled", "resend"]).default("disabled"),
    RESEND_API_KEY: optionalString,
    EMAIL_FROM: emailFrom,
    NOTIFICATION_EMAIL_TO: optionalCsvEmails,
    FILE_STORAGE_PROVIDER: z.enum(["disabled", "r2"]).default("disabled"),
    R2_ENDPOINT: optionalUrl,
    R2_REGION: z.string().min(1).default("auto"),
    R2_BUCKET: optionalString,
    R2_ACCESS_KEY_ID: optionalString,
    R2_SECRET_ACCESS_KEY: optionalString,
    FILE_DOCUMENT_MAX_BYTES: z.coerce.number().int().min(1).max(104_857_600).default(26_214_400),
    FILE_IMAGE_MAX_BYTES: z.coerce.number().int().min(1).max(104_857_600).default(15_728_640),
    FILE_ZIP_MAX_BYTES: z.coerce.number().int().min(1).max(524_288_000).default(104_857_600),
    FILE_UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(3_600).default(900),
    FILE_DOWNLOAD_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(3_600).default(300),
  })
  .superRefine((env, context) => {
    if (env.NODE_ENV === "production" && env.DATABASE_URL === undefined) {
      context.addIssue({
        code: "custom",
        path: ["DATABASE_URL"],
        message: "DATABASE_URL is required in production",
      });
    }
    if (env.CLERK_AUTH_ENABLED) {
      for (const [key, value] of [
        ["CLERK_PUBLISHABLE_KEY", env.CLERK_PUBLISHABLE_KEY],
        ["CLERK_SECRET_KEY", env.CLERK_SECRET_KEY],
      ] as const) {
        if (value === undefined) context.addIssue({ code: "custom", path: [key], message: `${key} is required when Clerk auth is enabled` });
      }
      if (env.CLERK_AUTHORIZED_PARTIES.length === 0) {
        context.addIssue({ code: "custom", path: ["CLERK_AUTHORIZED_PARTIES"], message: "At least one authorized party is required when Clerk auth is enabled" });
      }
    }
    if (env.CLERK_WEBHOOKS_ENABLED && env.CLERK_WEBHOOK_SIGNING_SECRET === undefined) {
      context.addIssue({ code: "custom", path: ["CLERK_WEBHOOK_SIGNING_SECRET"], message: "Webhook signing secret is required when Clerk webhooks are enabled" });
    }
    if (env.CLERK_WEBHOOKS_ENABLED && env.DATABASE_URL === undefined) {
      context.addIssue({ code: "custom", path: ["DATABASE_URL"], message: "DATABASE_URL is required when Clerk webhooks are enabled" });
    }
    if (env.EMAIL_PROVIDER === "resend") {
      for (const [key, value] of [
        ["RESEND_API_KEY", env.RESEND_API_KEY],
        ["EMAIL_FROM", env.EMAIL_FROM],
      ] as const) {
        if (value === undefined) context.addIssue({ code: "custom", path: [key], message: `${key} is required when Resend email is enabled` });
      }
      if (env.NOTIFICATION_EMAIL_TO.length === 0) {
        context.addIssue({ code: "custom", path: ["NOTIFICATION_EMAIL_TO"], message: "At least one notification recipient is required when Resend email is enabled" });
      }
    }
    if (env.FILE_STORAGE_PROVIDER === "r2") {
      for (const [key, value] of [
        ["R2_ENDPOINT", env.R2_ENDPOINT], ["R2_BUCKET", env.R2_BUCKET],
        ["R2_ACCESS_KEY_ID", env.R2_ACCESS_KEY_ID], ["R2_SECRET_ACCESS_KEY", env.R2_SECRET_ACCESS_KEY],
      ] as const) {
        if (value === undefined) context.addIssue({ code: "custom", path: [key], message: `${key} is required when R2 storage is enabled` });
      }
    }
  });

export type AppEnv = z.output<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const result = envSchema.safeParse(source);
  if (result.success) return result.data;

  const details = result.error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));

  throw new AppError({
    code: ErrorCode.ConfigurationError,
    message: "Invalid environment configuration",
    statusCode: 500,
    details,
  });
}
