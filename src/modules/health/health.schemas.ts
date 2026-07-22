import { Type, type Static } from "@sinclair/typebox";

const StatusSchema = Type.Union([Type.Literal("ok"), Type.Literal("ready"), Type.Literal("not_ready")]);

export const HealthResponseSchema = Type.Object(
  {
    data: Type.Object(
      {
        status: StatusSchema,
        timestamp: Type.String({ format: "date-time" }),
        uptimeSeconds: Type.Number({ minimum: 0 }),
        checks: Type.Optional(
          Type.Array(
            Type.Object({
              name: Type.String(),
              status: Type.Union([Type.Literal("up"), Type.Literal("down")]),
            }),
          ),
        ),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export type HealthResponse = Static<typeof HealthResponseSchema>;
