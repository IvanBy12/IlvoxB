import { describe, expect, it } from "vitest";
import {
  authorizeAudienceChange, authorizeFileRead, authorizeFileUpload, validateFileUploadMetadata,
} from "../../src/modules/files/file-authorization.js";
import { MemoryFileStorage } from "../../src/modules/files/file-storage.js";
import { ORG_A, ORG_B, actor } from "../helpers/actors.js";

const pdf = { originalName: "evidence.pdf", mimeType: "application/pdf", sizeBytes: 1024 };

describe("file authorization", () => {
  it("rejects internal and cross-organization reads for clients", () => {
    const client = actor({ permissions: [{ code: "files.read_client", scopes: ["organization"] }] });
    expect(authorizeFileRead(client, { organizationId: ORG_A, audience: "internal", status: "active",
      resourceAccess: true, direct: false }).allowed).toBe(false);
    expect(authorizeFileRead(client, { organizationId: ORG_B, audience: "organization", status: "active",
      resourceAccess: true, direct: false }).reason).toBe("ORGANIZATION");
  });

  it("allows organization uploads but never internal uploads for clients", () => {
    const client = actor({ roleCode: "client_manager", permissions: [
      { code: "files.upload_client", scopes: ["organization"] },
    ] });
    expect(authorizeFileUpload(client, { organizationId: ORG_A, audience: "organization",
      resourceAccess: true, direct: true }, pdf).allowed).toBe(true);
    expect(authorizeFileUpload(client, { organizationId: ORG_A, audience: "internal",
      resourceAccess: true, direct: false }, pdf).allowed).toBe(false);
  });

  it("prevents contacts from direct uploads and all clients from audience changes", () => {
    const contact = actor({ permissions: [{ code: "files.upload_client", scopes: ["organization"] }] });
    expect(authorizeFileUpload(contact, { organizationId: ORG_A, audience: "organization",
      resourceAccess: true, direct: true }, pdf).allowed).toBe(false);
    expect(authorizeAudienceChange(contact, { organizationId: ORG_A, audience: "organization",
      status: "active", resourceAccess: true, direct: false }, "internal").allowed).toBe(false);
  });

  it("allows authorized internal reads and auditable audience changes", () => {
    const internal = actor({ internal: true, permissions: [
      { code: "files.read", scopes: ["global"] },
      { code: "files.upload", scopes: ["global"] },
      { code: "organizations.access_all", scopes: ["global"] },
    ] });
    expect(authorizeFileRead(internal, { organizationId: ORG_B, audience: "internal", status: "active",
      resourceAccess: true, direct: false }).allowed).toBe(true);
    expect(authorizeAudienceChange(internal, { organizationId: ORG_B, audience: "internal", status: "active",
      resourceAccess: true, direct: false }, "organization").auditRequired).toBe(true);

    const assignedInternal = actor({ internal: true, organizations: [], permissions: [
      { code: "files.read", scopes: ["assigned"] },
    ] });
    expect(authorizeFileRead(assignedInternal, { organizationId: ORG_B, audience: "internal", status: "active",
      resourceAccess: true, direct: false }).allowed).toBe(true);
    expect(authorizeFileRead(assignedInternal, { organizationId: ORG_B, audience: "internal", status: "active",
      resourceAccess: false, direct: false }).reason).toBe("RESOURCE");
  });

  it("rejects quarantined files and unsafe metadata", () => {
    const internal = actor({ internal: true, permissions: [{ code: "files.read", scopes: ["global"] }] });
    expect(authorizeFileRead(internal, { organizationId: ORG_A, audience: "internal", status: "quarantined",
      resourceAccess: true, direct: false }).reason).toBe("STATUS");
    expect(validateFileUploadMetadata({ ...pdf, originalName: "../evidence.pdf" }).allowed).toBe(false);
    expect(validateFileUploadMetadata({ ...pdf, sizeBytes: 30 * 1024 * 1024 }).allowed).toBe(false);
  });

  it("provides an isolated in-memory storage adapter", async () => {
    const storage = new MemoryFileStorage();
    await storage.put("org/file.bin", Uint8Array.from([1, 2, 3]));
    expect([...await storage.read("org/file.bin")]).toEqual([1, 2, 3]);
    await storage.delete("org/file.bin");
    await expect(storage.read("org/file.bin")).rejects.toThrow("Object not found");
  });
});
