import { z } from "zod";
import { defineEvent } from "../define.js";
const scope = z
  .enum(["project", "global", "session", "cache"])
  .default("project");
const address = z.object({
  plugin: z.string().regex(/^[\w.-]+$/),
  key: z.string().min(1).max(256),
  scope,
});
export const storageRead = defineEvent({
  name: "service.storage.read",
  since: "0.9.0",
  version: 1,
  summary:
    "Read JSON in the calling plugin namespace; missing values return undefined.",
  input: address,
  responses: [
    {
      kind: "value",
      summary: "stored value",
      schema: z.object({ value: z.unknown() }),
    },
  ],
  frozen: true,
});
export const storageWrite = defineEvent({
  name: "service.storage.write",
  since: "0.9.0",
  version: 1,
  summary:
    "Atomically persist bounded JSON in the calling plugin namespace and selected scope.",
  input: address.extend({ value: z.unknown() }),
  responses: [
    {
      kind: "value",
      summary: "saved",
      schema: z.object({ value: z.unknown() }),
    },
  ],
  frozen: true,
});
export const storageConfig = defineEvent({
  name: "service.storage.config",
  since: "0.9.0",
  version: 1,
  summary: "Read merged global/project/local plugin configuration.",
  input: z.object({ plugin: z.string(), name: z.string().regex(/^[\w.-]+$/) }),
  responses: [
    {
      kind: "value",
      summary: "merged configuration",
      schema: z.object({ value: z.unknown() }),
    },
  ],
  frozen: true,
});
