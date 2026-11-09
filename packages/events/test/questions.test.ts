import { describe, it, expect } from "vitest";
import {
  questionnaireSchema,
  validateQuestionnaireResult,
} from "../src/questions.js";
const form = {
  questions: [
    {
      id: "target",
      question: "Target?",
      options: ["Stage", "Production"],
      allowOther: false,
    },
    {
      id: "tests",
      question: "Tests?",
      options: ["Unit", "Browser"],
      multi: true,
    },
  ],
};
describe("questionnaire contracts", () => {
  it("rejects duplicate IDs/labels, empty labels and oversized questionnaires", () => {
    for (const value of [
      { questions: [form.questions[0], form.questions[0]] },
      {
        questions: [
          { id: "a", question: "?", options: ["Same", { label: "Same" }] },
        ],
      },
      { questions: [{ id: "a", question: "?", options: [" "] }] },
      { questions: Array(9).fill(form.questions[0]) },
    ])
      expect(questionnaireSchema.safeParse(value).success).toBe(false);
  });
  it("orders complete valid answers by question ID and rejects fabricated, missing or incompatible answers", () => {
    const valid = {
      answers: [
        { id: "tests", selected: ["Unit"], text: "Load" },
        { id: "target", selected: ["Stage"] },
      ],
    };
    expect(
      validateQuestionnaireResult(form, valid).answers.map((a) => a.id),
    ).toEqual(["target", "tests"]);
    for (const answers of [
      [],
      [valid.answers[0], valid.answers[0]],
      [{ id: "target", selected: ["Stage", "Production"] }, valid.answers[0]],
      [{ id: "target", selected: ["Stage"], text: "Other" }, valid.answers[0]],
      [valid.answers[1], { id: "tests", selected: ["Fake"] }],
      [valid.answers[1], { id: "tests", selected: ["Unit", "Unit"] }],
      [valid.answers[1], { id: "tests", selected: [] }],
    ])
      expect(() => validateQuestionnaireResult(form, { answers })).toThrow();
  });
});
