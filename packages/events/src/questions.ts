import { z } from "zod";
export const questionOptionSchema = z.union([
  z.string().trim().min(1).max(160),
  z.object({
    label: z.string().trim().min(1).max(160),
    description: z.string().max(500).optional(),
    recommended: z.boolean().optional(),
  }),
]);
export type QuestionOption = z.infer<typeof questionOptionSchema>;
export const optionLabel = (option: QuestionOption) =>
  typeof option === "string" ? option : option.label;
export const questionSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z][\w-]{0,63}$/),
    question: z.string().trim().min(1).max(2000),
    header: z.string().max(40).optional(),
    options: z.array(questionOptionSchema).max(12).optional(),
    multi: z.boolean().optional(),
    allowOther: z.boolean().optional(),
  })
  .superRefine((q, ctx) => {
    const labels = (q.options ?? []).map(optionLabel);
    if (new Set(labels).size !== labels.length)
      ctx.addIssue({ code: "custom", message: "Option labels must be unique" });
  });
export const questionnaireSchema = z
  .object({
    title: z.string().max(120).optional(),
    questions: z.array(questionSchema).min(1).max(8),
  })
  .superRefine((form, ctx) => {
    if (new Set(form.questions.map((q) => q.id)).size !== form.questions.length)
      ctx.addIssue({ code: "custom", message: "Question IDs must be unique" });
  });
export type QuestionSpec = z.infer<typeof questionSchema>;
export type Questionnaire = z.infer<typeof questionnaireSchema>;
export const questionnaireResultSchema = z.object({
  answers: z
    .array(
      z.object({
        id: z.string(),
        selected: z.array(z.string()).max(12),
        text: z.string().trim().min(1).max(4000).optional(),
      }),
    )
    .max(8),
});
export type QuestionnaireResult = z.infer<typeof questionnaireResultSchema>;
export type UserQuestionAnswer = string | string[] | QuestionnaireResult;
/** options stay string[] for existing embedders; details carry richer labels. */
export interface UserQuestionRequest {
  question: string;
  options?: string[];
  optionDetails?: Exclude<QuestionOption, string>[];
  multi?: boolean;
  allowOther?: boolean;
  questions?: QuestionSpec[];
  signal?: AbortSignal;
}
export function validateQuestionnaireResult(
  form: Questionnaire,
  value: unknown,
): QuestionnaireResult {
  const result = questionnaireResultSchema.parse(value);
  if (
    result.answers.length !== form.questions.length ||
    new Set(result.answers.map((a) => a.id)).size !== result.answers.length
  )
    throw Error("Answer every question exactly once");
  for (const q of form.questions) {
    const answer = result.answers.find((a) => a.id === q.id);
    if (!answer) throw Error("Missing question answer");
    const labels = (q.options ?? []).map(optionLabel);
    if (
      new Set(answer.selected).size !== answer.selected.length ||
      answer.selected.some((s) => !labels.includes(s))
    )
      throw Error("Invalid selected option");
    const count = answer.selected.length + (answer.text ? 1 : 0);
    if (!count || (!q.multi && count > 1))
      throw Error("Invalid answer cardinality");
    if (labels.length && q.allowOther === false && answer.text)
      throw Error("Custom answers are disabled");
  }
  return {
    answers: form.questions.map(
      (q) => result.answers.find((a) => a.id === q.id)!,
    ),
  };
}
