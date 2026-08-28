import { Type, type Static } from "@sinclair/typebox";

export const FileIdParamsSchema = Type.Object({ fileId: Type.String({ format: "uuid" }) });
export const DeliverableFileParamsSchema = Type.Object({ deliverableId: Type.String({ format: "uuid" }) });
export const FileUploadIntentBodySchema = Type.Object({
  deliverableId: Type.String({ format: "uuid" }),
  originalName: Type.String({ minLength: 1, maxLength: 255 }),
  mimeType: Type.String({ minLength: 1, maxLength: 255 }),
  sizeBytes: Type.Integer({ minimum: 1, maximum: 104_857_600 }),
  checksumSha256: Type.Optional(Type.String({ pattern: "^[0-9a-fA-F]{64}$" })),
}, { additionalProperties: false });

export type FileIdParams = Static<typeof FileIdParamsSchema>;
export type DeliverableFileParams = Static<typeof DeliverableFileParamsSchema>;
export type FileUploadIntentBody = Static<typeof FileUploadIntentBodySchema>;
