import type { ToolSpec } from "@agent-compositor/tools";
import {
  questionSchema,
  questionnaireSchema,
  validateQuestionnaireResult,
  type QuestionOption,
  type Questionnaire,
  type QuestionnaireResult,
} from "@agent-compositor/events";
export interface AskArgs {
  question: string;
  options?: QuestionOption[];
  multi?: boolean;
  allowOther?: boolean;
}
const optionJson = {
  anyOf: [
    { type: "string" },
    {
      type: "object",
      properties: {
        label: { type: "string" },
        description: { type: "string" },
        recommended: { type: "boolean" },
      },
      required: ["label"],
    },
  ],
};
const fields = {
  question: {
    type: "string",
    description:
      "Self-contained question; include the decision and necessary context.",
  },
  options: {
    type: "array",
    maxItems: 12,
    items: optionJson,
    description:
      "Choices with optional descriptions/recommendations. Omit for free text.",
  },
  multi: {
    type: "boolean",
    description: "Allow multiple choices when they are compatible.",
  },
  allowOther: {
    type: "boolean",
    description:
      "Allow a custom written answer alongside choices (default true).",
  },
};
export const askTool: ToolSpec<
  AskArgs,
  {
    answer: string | string[];
  }
> = {
  name: "ask_user",
  description:
    "Ask one necessary human question with single/multiple choices or free text. Rich choices use label, description and optional recommended. Custom answers are allowed by default. Use ask_questions for a related questionnaire. Headless/cancel returns an error; never invent user answers or use this as a substitute for tool permissions.",
  parameters: { type: "object", properties: fields, required: ["question"] },
  describe: () => ({ tool: "ask_user" }),
  async execute(ctx, args) {
    try {
      const q = questionSchema.parse({ ...args, id: "answer" });
      const result = await ctx.request<{
        answer: string | string[];
      }>("service.ui.ask", {
        plugin: "core",
        question: q.question,
        options: q.options,
        multi: q.multi,
        allowOther: q.allowOther,
        signal: ctx.signal,
      });
      if (result?.answer === undefined) throw Error("No human answer returned");
      return { ok: true, data: { answer: result.answer } };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        denied: true,
      };
    }
  },
};
export const askQuestionsTool: ToolSpec<Questionnaire, QuestionnaireResult> = {
  name: "ask_questions",
  description:
    "Collect a related questionnaire (1–8 questions) in one human interaction. Each question has a unique id, question text, optional short header, choices, multi and allowOther. The user can go back, write custom answers, review and submit the complete set. Returns answers by id with selected labels and optional text. Ask only for decisions unavailable from context; cancellation/headless never manufactures answers.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string" },
      questions: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            header: { type: "string" },
            ...fields,
          },
          required: ["id", "question"],
        },
      },
    },
    required: ["questions"],
  },
  describe: () => ({ tool: "ask_questions" }),
  async execute(ctx, args) {
    try {
      const form = questionnaireSchema.parse(args);
      return {
        ok: true,
        data: validateQuestionnaireResult(
          form,
          await ctx.request<QuestionnaireResult>("service.ui.questionnaire", {
            plugin: "core",
            ...form,
            signal: ctx.signal,
          }),
        ),
      };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        denied: true,
      };
    }
  },
};
