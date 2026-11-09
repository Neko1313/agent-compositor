import { describe, it, expect } from "vitest";
import { QuestionDialog } from "../src/question.js";
const key = (dialog: QuestionDialog, key: string) =>
  dialog.handle({ kind: "key", key });
const text = (dialog: QuestionDialog, text: string) =>
  dialog.handle({ kind: "text", text });
function click(dialog: QuestionDialog, label: string, width = 60, height = 30) {
  const rows = dialog.visible(width, height);
  const row = rows.findIndex((r) => r.text.includes(label));
  expect(row).toBeGreaterThanOrEqual(0);
  return dialog.handle({
    kind: "mouse",
    action: "press",
    button: "left",
    row,
    col: 2,
  });
}
describe("human question dialog", () => {
  it("chooses the focused rich radio option without treating recommended as an answer", () => {
    const d = new QuestionDialog({
      question: "Target?",
      optionDetails: [
        { label: "Stage", description: "Preview first", recommended: true },
        { label: "Production" },
      ],
    });
    expect(
      d
        .rows(60)
        .map((r) => r.text)
        .join("\n"),
    ).toContain("Preview first");
    key(d, "down");
    expect(key(d, "enter")).toEqual({ answer: "Production" });
  });
  it("toggles compatible choices using Space and supports legacy numeric input", () => {
    const d = new QuestionDialog({
      question: "Tests?",
      options: ["Unit", "Integration", "Browser"],
      multi: true,
    });
    text(d, " ");
    key(d, "down");
    key(d, "down");
    key(d, "space");
    expect(key(d, "enter")).toEqual({ answer: ["Unit", "Browser"] });
    const old = new QuestionDialog({
      question: "Tests?",
      options: ["Unit", "Integration", "Browser"],
      multi: true,
    });
    text(old, "1,3");
    expect(key(old, "enter")).toEqual({ answer: ["Unit", "Browser"] });
  });
  it("rejects invalid numbers and empty answers without finishing", () => {
    const d = new QuestionDialog({
      question: "Tests?",
      options: ["Unit", "Integration"],
      multi: true,
    });
    expect(key(d, "enter")).toBeUndefined();
    expect(d.error).toContain("Choose");
    text(d, "9");
    expect(key(d, "enter")).toBeUndefined();
    expect(d.error).toContain("1 to 2");
    key(d, "backspace");
    text(d, "2");
    expect(key(d, "enter")).toEqual({ answer: ["Integration"] });
  });
  it("supports custom answers alongside multiple selections and enforces closed choices", () => {
    const d = new QuestionDialog({
      question: "Tests?",
      options: ["Unit", "Browser"],
      multi: true,
    });
    click(d, "Unit");
    click(d, "Other");
    text(d, "Load");
    expect(click(d, "[ Answer ]")).toEqual({ answer: ["Unit", "Load"] });
    const closed = new QuestionDialog({
      question: "Target?",
      options: ["Stage"],
      allowOther: false,
    });
    text(closed, "Custom");
    expect(closed.error).toContain("available");
    expect(closed.rows(60).some((r) => r.text.includes("Other /"))).toBe(false);
  });
  it("keeps drafts on Back and sends stable IDs only after explicit review submission", () => {
    const d = new QuestionDialog({
      question: "Setup",
      questions: [
        { id: "target", question: "Target?", options: ["Stage", "Production"] },
        {
          id: "tests",
          question: "Tests?",
          options: ["Unit", "Browser"],
          multi: true,
        },
      ],
    });
    click(d, "Production");
    expect(click(d, "[ Next ]")).toBeUndefined();
    click(d, "Browser");
    click(d, "Other");
    text(d, "Load");
    click(d, "[ Back ]");
    expect(d.rows(60).some((r) => r.text.includes("● 2) Production"))).toBe(
      true,
    );
    click(d, "[ Next ]");
    expect(d.draft).toBe("Load");
    expect(click(d, "[ Next ]")).toBeUndefined();
    expect(
      d
        .rows(60)
        .map((r) => r.text)
        .join("\n"),
    ).toContain("Review 2 answers");
    click(d, "1. Target?");
    key(d, "up");
    key(d, "enter");
    click(d, "[ Next ]");
    expect(click(d, "[ Submit answers ]")).toEqual({
      answer: {
        answers: [
          { id: "target", selected: ["Stage"] },
          { id: "tests", selected: ["Browser"], text: "Load" },
        ],
      },
    });
  });
  it("supports free text Tab navigation, cancellation and narrow scrolling mouse targets", () => {
    const free = new QuestionDialog({ question: "Name?" });
    text(free, "My project");
    key(free, "tab");
    expect(key(free, "enter")).toEqual({ answer: "My project" });
    const d = new QuestionDialog({
      question: "Choose",
      optionDetails: Array.from({ length: 12 }, (_, i) => ({
        label: `Option ${i + 1}`,
        description: "Details ".repeat(12),
      })),
      multi: true,
    });
    for (let i = 0; i < 11; i++) key(d, "down");
    const rows = d.visible(28, 8);
    expect(rows.some((r) => r.text.includes("Option 12"))).toBe(true);
    const row = rows.findIndex((r) => r.text.includes("Option 12"));
    expect(d.interactiveRow(row)).toBe(true);
    d.handle({ kind: "mouse", action: "press", button: "left", row, col: 1 });
    expect(key(d, "enter")).toEqual({ answer: ["Option 12"] });
    expect(key(new QuestionDialog({ question: "Cancel?" }), "escape")).toBe(
      "cancel",
    );
  });
});
