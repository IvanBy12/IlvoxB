import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

export interface FileStorage {
  put(objectKey: string, content: Uint8Array): Promise<void>;
  read(objectKey: string): Promise<Uint8Array>;
  delete(objectKey: string): Promise<void>;
}

function validateObjectKey(objectKey: string): void {
  if (objectKey.length === 0 || objectKey.startsWith("/") || objectKey.includes("\\") || objectKey.includes("..")) {
    throw new Error("Invalid object key");
  }
}

export class MemoryFileStorage implements FileStorage {
  private readonly objects = new Map<string, Uint8Array>();
  put(objectKey: string, content: Uint8Array): Promise<void> {
    validateObjectKey(objectKey);
    this.objects.set(objectKey, new Uint8Array(content));
    return Promise.resolve();
  }
  read(objectKey: string): Promise<Uint8Array> {
    validateObjectKey(objectKey);
    const content = this.objects.get(objectKey);
    if (content === undefined) return Promise.reject(new Error("Object not found"));
    return Promise.resolve(new Uint8Array(content));
  }
  delete(objectKey: string): Promise<void> {
    validateObjectKey(objectKey);
    this.objects.delete(objectKey);
    return Promise.resolve();
  }
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

  async put(objectKey: string, content: Uint8Array): Promise<void> {
    const path = this.pathFor(objectKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, { flag: "wx" });
  }
  async read(objectKey: string): Promise<Uint8Array> { return readFile(this.pathFor(objectKey)); }
  async delete(objectKey: string): Promise<void> { await rm(this.pathFor(objectKey), { force: true }); }
}
