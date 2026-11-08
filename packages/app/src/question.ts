import type { AgentCoreOptions } from "@agent-compositor/core";
import type { WireMessage } from "@agent-compositor/protocol";
import { textRows, type Row } from "./presentation.js";

export type QuestionRequest = Parameters<NonNullable<AgentCoreOptions["onAsk"]>>[0];
type Input = Extract<WireMessage, { type: "input" }>["data"];

/** Human questions have their own draft and never enter the prompt queue. */
export class QuestionDialog {
  draft = "";
  scroll = 0;
  error = "";
  constructor(readonly request: QuestionRequest) {}

  rows(columns: number): Row[] {
    return [
      ...textRows(this.request.question, columns, "accent").map(row => ({ ...row, bold: true })),
      ...(this.request.options ?? []).flatMap((option, index) => textRows(`${index + 1}) ${option}`, columns)),
      ...textRows(this.request.options?.length ? this.request.multi ? "Numbers separated by commas · Enter answer · Esc cancel" : "Number · Enter answer · Esc cancel"
        : "Enter answer · Esc cancel", columns, "muted"),
      ...(this.error ? textRows(this.error, columns, "danger") : []),
    ];
  }

  visible(columns: number, height: number): Row[] {
    const rows = this.rows(columns);
    this.scroll = Math.min(this.scroll, Math.max(0, rows.length - height + 1));
    return [...rows.slice(this.scroll, this.scroll + height - 1),
      ...textRows(`› ${this.draft}▏`, columns).slice(-1)];
  }

  handle(input: Input): { answer: string | string[] } | "cancel" | undefined {
    if (input.kind === "text") { this.draft += input.text.replace(/[\x00-\x1f\x7f]/g, " "); this.error = ""; }
    if (input.kind !== "key") return;
    if (input.key === "escape") return "cancel";
    if (input.key === "backspace" || input.key === "delete") { this.draft = this.draft.slice(0, -1); this.error = ""; }
    if (["up", "pageup"].includes(input.key)) this.scroll = Math.max(0, this.scroll - 1);
    if (["down", "pagedown"].includes(input.key)) this.scroll++;
    if (input.key !== "enter") return;
    const value = this.draft.trim(), options = this.request.options ?? [];
    if (!value) { this.error = "Enter an answer, or Esc to cancel."; return; }
    if (!options.length) return { answer: value };
    const numbers = value.split(",").map(s => Number(s.trim()));
    if (numbers.some(n => !Number.isInteger(n) || n < 1 || n > options.length) || (!this.request.multi && numbers.length !== 1)) {
      this.error = `Choose ${this.request.multi ? "numbers" : "one number"} from 1 to ${options.length}.`; return;
    }
    const answers = [...new Set(numbers)].map(n => options[n - 1]);
    return { answer: this.request.multi ? answers : answers[0] };
  }
}
