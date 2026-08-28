import { createHash, randomUUID } from "node:crypto";
import "dotenv/config";
import { Pool } from "pg";
import { buildApp } from "../src/app.js";
import type { ActorContext } from "../src/common/auth/authorization.types.js";
import { FileRepository } from "../src/modules/files/file.repository.js";
import { R2FileStorage } from "../src/modules/files/file-storage.js";
import type { AuthenticationProvider } from "../src/plugins/clerk.js";

const PREFIX = "PHASE_R2_COMPLETE_SMOKE_";
const marker = `${PREFIX}${randomUUID().replaceAll("-", "")}`;
const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") throw new Error(`${name}_MISSING`);
  return value;
};
function assert(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(label);
}
const errorDetails = (error: unknown) => {
  const candidate = error as { readonly name?: string; readonly message?: string; readonly code?: string;
    readonly constraint?: string; readonly $metadata?: { readonly httpStatusCode?: number } };
  return { name: candidate.name ?? null, message: candidate.message ?? String(error), sqlstate: candidate.code ?? null,
    constraint: candidate.constraint ?? null, httpStatus: candidate.$metadata?.httpStatusCode ?? null };
};

const pool = new Pool({ connectionString: required("DATABASE_URL"), application_name: "ilvox-r2-complete-smoke" });
const repository = new FileRepository(pool);
const storage = new R2FileStorage({ endpoint: required("R2_ENDPOINT"), region: process.env.R2_REGION ?? "auto",
  bucket: required("R2_BUCKET"), accessKeyId: required("R2_ACCESS_KEY_ID"), secretAccessKey: required("R2_SECRET_ACCESS_KEY") });
const body = new Uint8Array(16_384);
body.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const checksumSha256 = createHash("sha256").update(body).digest("hex");
const deliverableId = randomUUID();

let fileId: string | undefined;
let objectKey: string | undefined;
let smokeError: unknown;
let app: Awaited<ReturnType<typeof buildApp>> | undefined;
try {
  const fixture = await pool.query<{ readonly project_id: string; readonly organization_id: string; readonly user_id: string }>(
    `SELECT p.id AS project_id, p.organization_id, p.created_by_user_id AS user_id
       FROM projects p
       JOIN app_users u ON u.id=p.created_by_user_id AND u.status='active'
      ORDER BY p.created_at DESC
      LIMIT 1`,
  );
  const selected = fixture.rows[0];
  assert(selected !== undefined, "PHASE_R2_COMPLETE_SMOKE_FIXTURE_MISSING");
  await pool.query(`INSERT INTO deliverables
    (id,project_id,organization_id,name,delivery_party,due_date,status)
    VALUES ($1,$2,$3,$4,'client',CURRENT_DATE + 1,'pending')`,
  [deliverableId, selected.project_id, selected.organization_id, marker]);
  const actor: ActorContext = { clerkUserId: `${marker}_actor`, localUserId: selected.user_id, status: "active",
    internal: false, memberships: [{ organizationId: selected.organization_id, roleId: randomUUID(),
      roleCode: "client_contact", status: "active" }], roles: [], permissions: [
      { code: "files.upload_client", scopes: ["organization"] }, { code: "files.read_client", scopes: ["organization"] },
    ] };
  const authenticationProvider: AuthenticationProvider = { authenticate: () => Promise.resolve({ clerkUserId: actor.clerkUserId }) };
  app = await buildApp({ env: { ...process.env, NODE_ENV: "test", DATABASE_URL: "", LOG_LEVEL: "silent",
    CLERK_AUTH_ENABLED: "false", CLERK_WEBHOOKS_ENABLED: "false", CLERK_SECRET_KEY: "", FILE_STORAGE_PROVIDER: "disabled" },
  logger: false, authenticationProvider, identityRepository: { findByClerkUserId: () => Promise.resolve({ actor,
    primaryEmail: `${marker}@example.test`, firstName: "R2", lastName: "Smoke", avatarUrl: null }) },
  fileRepository: repository, fileStorage: storage });
  const intentResponse = await app.inject({ method: "POST", url: "/api/v1/files/upload-intents", headers: { "user-agent": marker },
    payload: { deliverableId, originalName: `${marker}.png`, mimeType: "image/png", sizeBytes: body.byteLength, checksumSha256 } });
  assert(intentResponse.statusCode === 201, `PHASE_R2_COMPLETE_SMOKE_INTENT_HTTP_${intentResponse.statusCode}_${intentResponse.body}`);
  const intent = intentResponse.json<{ readonly data: { readonly file: { readonly id: string };
    readonly upload: { readonly url: string; readonly headers: Readonly<Record<string, string>> } } }>().data;
  fileId = intent.file.id;
  const pending = await pool.query<{ readonly status: string; readonly object_key: string; readonly checksum_sha256: string | null }>(
    "SELECT status,object_key,checksum_sha256 FROM files WHERE id=$1", [fileId]);
  assert(pending.rows[0]?.status === "pending_upload", "PHASE_R2_COMPLETE_SMOKE_NOT_PENDING");
  assert(pending.rows[0]?.checksum_sha256 === checksumSha256, "PHASE_R2_COMPLETE_SMOKE_DB_CHECKSUM_MISMATCH");
  objectKey = pending.rows[0]?.object_key;
  assert(objectKey !== undefined, "PHASE_R2_COMPLETE_SMOKE_OBJECT_KEY_MISSING");

  const put = await fetch(intent.upload.url, { method: "PUT", headers: intent.upload.headers, body });
  assert(put.ok, `PHASE_R2_COMPLETE_SMOKE_PUT_${put.status}`);
  const stored = await storage.head(objectKey);
  assert(stored?.sizeBytes === body.byteLength, "PHASE_R2_COMPLETE_SMOKE_R2_SIZE_MISMATCH");
  assert(stored.mimeType?.toLowerCase() === "image/png", "PHASE_R2_COMPLETE_SMOKE_R2_MIME_MISMATCH");
  const prefix = await storage.readPrefix(objectKey, 8_192);
  assert(prefix.byteLength === 8_192 && prefix.slice(0, 8).every((value, index) => value === body[index]),
    "PHASE_R2_COMPLETE_SMOKE_PREFIX_MISMATCH");

  const firstResponse = await app.inject({ method: "POST", url: `/api/v1/files/${fileId}/complete`, headers: { "user-agent": marker } });
  assert(firstResponse.statusCode === 200, `PHASE_R2_COMPLETE_SMOKE_FIRST_HTTP_${firstResponse.statusCode}_${firstResponse.body}`);
  const first = firstResponse.json<{ readonly data: { readonly id: string; readonly status: string } }>().data;
  assert(first.status === "active", "PHASE_R2_COMPLETE_SMOKE_FIRST_NOT_ACTIVE");
  const secondResponse = await app.inject({ method: "POST", url: `/api/v1/files/${fileId}/complete`, headers: { "user-agent": marker } });
  assert(secondResponse.statusCode === 200, `PHASE_R2_COMPLETE_SMOKE_SECOND_HTTP_${secondResponse.statusCode}_${secondResponse.body}`);
  const second = secondResponse.json<{ readonly data: { readonly id: string; readonly status: string } }>().data;
  assert(second.id === first.id && second.status === "active", "PHASE_R2_COMPLETE_SMOKE_NOT_IDEMPOTENT");
  const malformedResponse = await app.inject({ method: "POST", url: `/api/v1/files/${fileId.slice(0, -1)}/complete`,
    headers: { "user-agent": marker } });
  assert(malformedResponse.statusCode === 400,
    `PHASE_R2_COMPLETE_SMOKE_MALFORMED_ID_HTTP_${malformedResponse.statusCode}_${malformedResponse.body}`);
  const persisted = await pool.query<{ readonly status: string; readonly checksum_sha256: string | null }>(
    "SELECT status,checksum_sha256 FROM files WHERE id=$1", [fileId]);
  assert(persisted.rows[0]?.status === "active", "PHASE_R2_COMPLETE_SMOKE_DB_NOT_ACTIVE");
  assert(persisted.rows[0]?.checksum_sha256 === checksumSha256, "PHASE_R2_COMPLETE_SMOKE_FINAL_CHECKSUM_MISMATCH");
  const listResponse = await app.inject({ method: "GET", url: `/api/v1/deliverables/${deliverableId}/files`,
    headers: { "user-agent": marker } });
  assert(listResponse.statusCode === 200, `PHASE_R2_COMPLETE_SMOKE_LIST_HTTP_${listResponse.statusCode}_${listResponse.body}`);
  const listed = listResponse.json<{ readonly data: readonly { readonly id: string; readonly status: string }[] }>().data;
  assert(listed.some((file) => file.id === fileId && file.status === "active"), "PHASE_R2_COMPLETE_SMOKE_LIST_MISSING");
  const downloadUrlResponse = await app.inject({ method: "POST", url: `/api/v1/files/${fileId}/download-url`,
    headers: { "user-agent": marker } });
  assert(downloadUrlResponse.statusCode === 200,
    `PHASE_R2_COMPLETE_SMOKE_DOWNLOAD_URL_HTTP_${downloadUrlResponse.statusCode}_${downloadUrlResponse.body}`);
  const downloadUrl = downloadUrlResponse.json<{ readonly data: { readonly url: string } }>().data.url;
  const download = await fetch(downloadUrl);
  assert(download.ok, `PHASE_R2_COMPLETE_SMOKE_DOWNLOAD_${download.status}`);
  const downloaded = new Uint8Array(await download.arrayBuffer());
  assert(downloaded.byteLength === body.byteLength && createHash("sha256").update(downloaded).digest("hex") === checksumSha256,
    "PHASE_R2_COMPLETE_SMOKE_DOWNLOAD_CONTENT_MISMATCH");
  console.log(JSON.stringify({ marker, uploadIntent: "pending_upload", put: put.status, stored: true,
    storedSize: stored.sizeBytes, storedMime: stored.mimeType, complete: first.status, idempotent: true,
    checksum: "sha256-hex-preserved", prefixMatches: true, listed: true, download: download.status }));
} catch (error) {
  smokeError = error;
  console.error(JSON.stringify({ marker, error: errorDetails(error) }));
} finally {
  await app?.close().catch((error) => { if (smokeError === undefined) smokeError = error; });
  if (objectKey !== undefined) await storage.delete(objectKey).catch((error) => { if (smokeError === undefined) smokeError = error; });
  if (fileId !== undefined) {
    await pool.query("DELETE FROM audit_events WHERE entity_type='file' AND entity_id=$1", [fileId])
      .catch((error) => { if (smokeError === undefined) smokeError = error; });
    await pool.query("DELETE FROM files WHERE id=$1 AND original_name=$2", [fileId, `${marker}.png`])
      .catch((error) => { if (smokeError === undefined) smokeError = error; });
  }
  await pool.query("DELETE FROM deliverables WHERE id=$1 AND name=$2", [deliverableId, marker])
    .catch((error) => { if (smokeError === undefined) smokeError = error; });
  const residualMetadata = fileId === undefined ? 0 : Number((await pool.query<{ readonly count: string }>(
    "SELECT count(*)::text AS count FROM files WHERE id=$1", [fileId])).rows[0]?.count ?? -1);
  const residualObject = objectKey === undefined ? false : await storage.head(objectKey).then((value) => value !== null).catch(() => true);
  const residualDeliverable = Number((await pool.query<{ readonly count: string }>(
    "SELECT count(*)::text AS count FROM deliverables WHERE id=$1", [deliverableId])).rows[0]?.count ?? -1);
  console.log(JSON.stringify({ marker, residualMetadata, residualObject, residualDeliverable }));
  await pool.end();
}
if (smokeError !== undefined) throw smokeError instanceof Error ? smokeError : new Error("PHASE_R2_COMPLETE_SMOKE_FAILED", { cause: smokeError });
