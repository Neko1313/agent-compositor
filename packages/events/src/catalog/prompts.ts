import { z } from "zod";
import { defineEvent } from "../define.js";

export const commandInvoke = defineEvent({
  name: 'command.invoke', since: '0.25.0', version: 1,
  summary: 'An explicitly registered immediate user command. Only its owning plugin handles it; no model prompt or view is implied.',
  input: z.object({plugin:z.string().min(1),name:z.string().min(1),text:z.string(),args:z.string()}),
  responses: [], frozen: true,
});
export const commandOperation = defineEvent({
  name:'command.operation',since:'0.25.0',version:1,
  summary:'An independently owned user command starts or settles, outside the model turn.',
  input:z.object({operationId:z.string(),name:z.string(),plugin:z.string(),phase:z.enum(['started','completed']),ok:z.boolean().optional(),error:z.string().optional()}),
  responses:[],frozen:true,
});

export const promptSubmit = defineEvent({
  name: "prompt.submit",
  since: "0.1.0",
  version: 1,
  summary: "A prompt is submitted. Rewrite text/context via next(), or drop it.",
  input: z.object({
    text: z.string(),
    context: z.array(z.unknown()).optional(),
  }),
  responses: [
    { kind: "next", summary: "pass on, possibly rewritten", schema: z.unknown() },
    { kind: "text", summary: "replace submitted text", schema: z.object({ text: z.string() }) },
    { kind: "drop", summary: "drop the prompt", schema: z.object({ drop: z.string() }) },
  ],
  frozen: true,
});

export const promptCompose = defineEvent({
  name: "prompt.compose",
  since: "0.1.0",
  version: 1,
  summary: "The system prompt is being assembled. Respond with ordered sections.",
  input: z.object({}),
  responses: [
    {
      kind: "sections",
      summary: "sections in send order",
      schema: z.object({
        sections: z.array(z.object({ id: z.string(), text: z.string(), scope: z.string().optional() })),
      }),
    },
  ],
  frozen: true,
});

export const skillPrompt = defineEvent({
  name: "skill.prompt",
  since: "0.1.0",
  version: 1,
  summary: "A skill's text is expanded for the model.",
  input: z.object({
    skill: z.string(),
    text: z.string(),
    source: z.string().optional(),
    pluginName: z.string().optional(),
    path: z.string().optional(),
  }),
  responses: [
    { kind: "next", summary: "keep the text", schema: z.unknown() },
    { kind: "text", summary: "replace the text", schema: z.object({ text: z.string().nullable() }) },
  ],
  frozen: true,
});
