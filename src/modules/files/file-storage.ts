import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface StoredObjectMetadata { readonly sizeBytes: number; readonly mimeType: string | null; }
export interface SignedStorageUrl {
  readonly url: string;
  readonly expiresAt: Date;
  readonly headers: Readonly<Record<string, string>>;
}
export interface FileStorage {
  createUploadUrl(objectKey: string, mimeType: string, sizeBytes: number, ttlSeconds: number, checksumSha256?: string): Promise<SignedStorageUrl>;
  createDownloadUrl(objectKey: string, downloadName: string, ttlSeconds: number): Promise<SignedStorageUrl>;
  head(objectKey: string): Promise<StoredObjectMetadata | null>;
  readPrefix(objectKey: string, length: number): Promise<Uint8Array>;
  delete(objectKey: string): Promise<void>;
}

export function validateObjectKey(objectKey: string): void {
  if (objectKey.length === 0 || objectKey.startsWith("/") || objectKey.includes("\\") || objectKey.includes("..")) {
    throw new Error("Invalid object key");
  }
}

export class MemoryFileStorage implements FileStorage {
  private readonly objects = new Map<string, { readonly content: Uint8Array; readonly mimeType: string }>();
  put(objectKey: string, content: Uint8Array, mimeType = "application/octet-stream"): Promise<void> {
    validateObjectKey(objectKey);
    this.objects.set(objectKey, { content: new Uint8Array(content), mimeType });
    return Promise.resolve();
  }
  read(objectKey: string): Promise<Uint8Array> {
    validateObjectKey(objectKey);
    const object = this.objects.get(objectKey);
    if (object === undefined) return Promise.reject(new Error("Object not found"));
    return Promise.resolve(new Uint8Array(object.content));
  }
  createUploadUrl(objectKey: string, mimeType: string, _sizeBytes: number, ttlSeconds: number, checksumSha256?: string): Promise<SignedStorageUrl> {
    validateObjectKey(objectKey);
    return Promise.resolve({ url: `memory://upload/${encodeURIComponent(objectKey)}`, expiresAt: new Date(Date.now() + ttlSeconds * 1_000), headers: { "Content-Type": mimeType,
      ...(checksumSha256 === undefined ? {} : { "x-amz-checksum-sha256": Buffer.from(checksumSha256, "hex").toString("base64") }) } });
  }
  createDownloadUrl(objectKey: string, _downloadName: string, ttlSeconds: number): Promise<SignedStorageUrl> {
    validateObjectKey(objectKey);
    return Promise.resolve({ url: `memory://download/${encodeURIComponent(objectKey)}`, expiresAt: new Date(Date.now() + ttlSeconds * 1_000), headers: {} });
  }
  head(objectKey: string): Promise<StoredObjectMetadata | null> {
    validateObjectKey(objectKey);
    const object = this.objects.get(objectKey);
    return Promise.resolve(object === undefined ? null : { sizeBytes: object.content.byteLength, mimeType: object.mimeType });
  }
  async readPrefix(objectKey: string, length: number): Promise<Uint8Array> { return (await this.read(objectKey)).slice(0, length); }
  delete(objectKey: string): Promise<void> { validateObjectKey(objectKey); this.objects.delete(objectKey); return Promise.resolve(); }
}

export class LocalFileStorage implements FileStorage {
  private readonly root: string;
  constructor(root: string) { this.root = resolve(root); }
  private pathFor(objectKey: string): string {
    validateObjectKey(objectKey);
    const path = resolve(this.root, objectKey);
    if (!path.startsWith(`${this.root}${sep}`)) throw new Error("Object key escapes storage root");
    return path;
  }
  async put(objectKey: string, content: Uint8Array): Promise<void> { const path = this.pathFor(objectKey); await mkdir(dirname(path), { recursive: true }); await writeFile(path, content, { flag: "wx" }); }
  read(objectKey: string): Promise<Uint8Array> { return readFile(this.pathFor(objectKey)); }
  createUploadUrl(): Promise<SignedStorageUrl> { return Promise.reject(new Error("Local storage does not support direct signed uploads")); }
  createDownloadUrl(): Promise<SignedStorageUrl> { return Promise.reject(new Error("Local storage does not support signed downloads")); }
  async head(objectKey: string): Promise<StoredObjectMetadata | null> {
    try { const metadata = await stat(this.pathFor(objectKey)); return { sizeBytes: metadata.size, mimeType: null }; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }
  async readPrefix(objectKey: string, length: number): Promise<Uint8Array> { return (await readFile(this.pathFor(objectKey))).slice(0, length); }
  async delete(objectKey: string): Promise<void> { await rm(this.pathFor(objectKey), { force: true }); }
}

export interface R2FileStorageOptions {
  readonly endpoint: string; readonly region: string; readonly bucket: string;
  readonly accessKeyId: string; readonly secretAccessKey: string;
}
function safeDispositionFilename(filename: string): string { return filename.replaceAll(/["\\\r\n]/g, "_"); }

export class R2FileStorage implements FileStorage {
  private readonly client: S3Client;
  constructor(private readonly options: R2FileStorageOptions) {
    this.client = new S3Client({ region: options.region, endpoint: options.endpoint, forcePathStyle: true,
      // R2 reports the whole-object checksum on ranged GETs; the partial body cannot be compared to it.
      responseChecksumValidation: "WHEN_REQUIRED",
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey } });
  }
  async createUploadUrl(objectKey: string, mimeType: string, sizeBytes: number, ttlSeconds: number, checksumSha256?: string): Promise<SignedStorageUrl> {
    validateObjectKey(objectKey);
    const encodedChecksum = checksumSha256 === undefined ? undefined : Buffer.from(checksumSha256, "hex").toString("base64");
    const command = new PutObjectCommand({ Bucket: this.options.bucket, Key: objectKey, ContentType: mimeType,
      ContentLength: sizeBytes, ...(encodedChecksum === undefined ? {} : { ChecksumSHA256: encodedChecksum }) });
    return { url: await getSignedUrl(this.client, command, {
      expiresIn: ttlSeconds,
      signableHeaders: new Set(["content-type"]),
      ...(encodedChecksum === undefined ? {} : {
        unhoistableHeaders: new Set(["x-amz-checksum-sha256"]),
      }),
    }), expiresAt: new Date(Date.now() + ttlSeconds * 1_000), headers: { "Content-Type": mimeType,
      ...(encodedChecksum === undefined ? {} : { "x-amz-checksum-sha256": encodedChecksum }) } };
  }
  async createDownloadUrl(objectKey: string, downloadName: string, ttlSeconds: number): Promise<SignedStorageUrl> {
    validateObjectKey(objectKey);
    const command = new GetObjectCommand({ Bucket: this.options.bucket, Key: objectKey,
      ResponseContentDisposition: `attachment; filename="${safeDispositionFilename(downloadName)}"` });
    return { url: await getSignedUrl(this.client, command, { expiresIn: ttlSeconds }), expiresAt: new Date(Date.now() + ttlSeconds * 1_000), headers: {} };
  }
  async head(objectKey: string): Promise<StoredObjectMetadata | null> {
    validateObjectKey(objectKey);
    try {
      const response = await this.client.send(new HeadObjectCommand({ Bucket: this.options.bucket, Key: objectKey }));
      return { sizeBytes: response.ContentLength ?? 0, mimeType: response.ContentType ?? null };
    } catch (error) {
      if ((error as { readonly $metadata?: { readonly httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
      throw error;
    }
  }
  async readPrefix(objectKey: string, length: number): Promise<Uint8Array> {
    validateObjectKey(objectKey);
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.options.bucket, Key: objectKey, Range: `bytes=0-${Math.max(0, length - 1)}` }));
    if (response.Body === undefined) throw new Error("Stored object has no body");
    return response.Body.transformToByteArray();
  }
  async delete(objectKey: string): Promise<void> { validateObjectKey(objectKey); await this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: objectKey })); }
}
