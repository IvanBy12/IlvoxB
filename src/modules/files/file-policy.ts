export interface FileUploadMetadata { readonly originalName: string; readonly mimeType: string; readonly sizeBytes: number; }
export interface FilePolicyLimits { readonly documentBytes: number; readonly imageBytes: number; readonly zipBytes: number; }
export interface ValidatedFileMetadata extends FileUploadMetadata { readonly originalName: string; readonly extension: string; }
export type FileMetadataValidation = { readonly allowed: true; readonly metadata: ValidatedFileMetadata } |
  { readonly allowed: false; readonly message: string };

export const DEFAULT_FILE_LIMITS: FilePolicyLimits = {
  documentBytes: 25 * 1024 * 1024,
  imageBytes: 15 * 1024 * 1024,
  zipBytes: 100 * 1024 * 1024,
};

const MIME_BY_EXTENSION: Readonly<Record<string, readonly string[]>> = {
  pdf: ["application/pdf"],
  csv: ["text/csv", "application/csv", "application/vnd.ms-excel", "text/plain"],
  xls: ["application/vnd.ms-excel", "application/octet-stream"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/zip"],
  zip: ["application/zip", "application/x-zip-compressed", "application/octet-stream"],
  doc: ["application/msword", "application/rtf", "text/rtf", "application/octet-stream"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip"],
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
};

function extensionOf(filename: string): string | undefined {
  const lastDot = filename.lastIndexOf(".");
  return lastDot <= 0 || lastDot === filename.length - 1 ? undefined : filename.slice(lastDot + 1).toLowerCase();
}
function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}
function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); return true; } catch { return false; }
}

export class FilePolicy {
  constructor(readonly limits: FilePolicyLimits = DEFAULT_FILE_LIMITS) {}

  normalizeFilename(value: string): string {
    const printable = [...value.normalize("NFKC")]
      .filter((character) => {
        const code = character.charCodeAt(0);
        return code > 31 && code !== 127;
      })
      .join("");
    return printable.replaceAll(/\s+/g, " ").trim();
  }

  validateMetadata(input: FileUploadMetadata): FileMetadataValidation {
    if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0) return { allowed: false, message: "El tamaño debe ser mayor que cero." };
    if (input.originalName.includes("/") || input.originalName.includes("\\") || input.originalName.includes("\0")) return { allowed: false, message: "El nombre del archivo no es válido." };
    const originalName = this.normalizeFilename(input.originalName);
    if (originalName.length === 0 || originalName.length > 255 || originalName === "." || originalName === "..") return { allowed: false, message: "El nombre del archivo no es válido." };
    const extension = extensionOf(originalName);
    const allowedMimes = extension === undefined ? undefined : MIME_BY_EXTENSION[extension];
    const mimeType = input.mimeType.trim().toLowerCase().split(";", 1)[0] ?? "";
    if (extension === undefined || allowedMimes === undefined || !allowedMimes.includes(mimeType)) return { allowed: false, message: "El formato o MIME del archivo no está permitido." };
    const maximum = extension === "zip" ? this.limits.zipBytes : ["png", "jpg", "jpeg"].includes(extension) ? this.limits.imageBytes : this.limits.documentBytes;
    if (input.sizeBytes > maximum) return { allowed: false, message: `El archivo excede el límite de ${Math.floor(maximum / 1024 / 1024)} MB.` };
    return { allowed: true, metadata: { originalName, extension, mimeType, sizeBytes: input.sizeBytes } };
  }

  validateSignature(extension: string, bytes: Uint8Array): boolean {
    if (extension === "pdf") return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
    if (extension === "png") return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (["jpg", "jpeg"].includes(extension)) return startsWith(bytes, [0xff, 0xd8, 0xff]);
    if (["zip", "xlsx", "docx"].includes(extension)) return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]);
    if (extension === "xls") return startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    if (extension === "doc") return startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) || new TextDecoder().decode(bytes.slice(0, 5)) === "{\\rtf";
    return extension === "csv" && looksLikeText(bytes);
  }
}

export const defaultFilePolicy = new FilePolicy();
