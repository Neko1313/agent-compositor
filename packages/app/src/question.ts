import type { AgentCoreOptions } from "@agent-compositor/core";
import {
  optionLabel,
  type QuestionSpec,
  type QuestionnaireResult,
  type UserQuestionAnswer,
} from "@agent-compositor/events";
import type { WireMessage } from "@agent-compositor/protocol";
import { textRows, type Row } from "./presentation.js";
export type QuestionRequest = Parameters<
  NonNullable<AgentCoreOptions["onAsk"]>
>[0];
type Input = Extract<
  WireMessage,
  {
    type: "input";
  }
>["data"];
type Target = {
  kind: "option" | "other" | "back" | "next" | "edit" | "submit";
  index?: number;
};
type DialogRow = Row & {
  target?: Target;
};
interface Draft {
  selected: Set<number>;
  text: string;
  numbers: string;
  cursor: number;
  textCursor: number;
  editing: boolean;
  focus: "options" | "text" | "back" | "next";
}
/** One queued interaction owns every draft until explicit submission/cancellation. */
export class QuestionDialog {
  scroll = 0;
  error = "";
  index = 0;
  private reveal = true;
  private hits = new Map<number, Target>();
  private reviewCursor = 0;
  readonly questions: QuestionSpec[];
  private drafts: Draft[];
  constructor(readonly request: QuestionRequest) {
    this.questions = request.questions ?? [
      {
        id: "answer",
        question: request.question,
        options: request.optionDetails ?? request.options,
        multi: request.multi,
        allowOther: request.allowOther,
      },
    ];
    this.drafts = this.questions.map((q) => ({
      selected: new Set(),
      text: "",
      numbers: "",
      cursor: 0,
      textCursor: 0,
      editing: !q.options?.length,
      focus: q.options?.length ? "options" : "text",
    }));
  }
  get draft() {
    const d = this.drafts[Math.min(this.index, this.drafts.length - 1)];
    return d.numbers || d.text;
  }
  interactiveRow(row: number) {
    return this.hits.has(row);
  }
  get review() {
    return this.index === this.questions.length;
  }
  private get q() {
    return this.questions[this.index];
  }
  private get state() {
    return this.drafts[this.index];
  }
  private get other() {
    return !this.q.options?.length || this.q.allowOther !== false;
  }
  private selectedAnswer(index: number) {
    const q = this.questions[index],
      d = this.drafts[index];
    return {
      id: q.id,
      selected: [...d.selected]
        .sort((a, b) => a - b)
        .map((i) => optionLabel(q.options![i])),
      ...(d.text.trim() ? { text: d.text.trim() } : {}),
    };
  }
  private body(columns: number): DialogRow[] {
    if (this.review) {
      const rows: DialogRow[] = [
        {
          text: `${this.request.question} · Review ${this.questions.length} answers`,
          tone: "accent",
          bold: true,
        },
      ];
      for (const [i, q] of this.questions.entries()) {
        const answer = this.selectedAnswer(i);
        rows.push(
          ...textRows(
            `${i + 1}. ${q.header ?? q.question}`,
            columns,
            "accent",
          ).map((r) => ({
            ...r,
            bold: true,
            selected: this.reviewCursor === i,
            target: { kind: "edit" as const, index: i },
          })),
        );
        rows.push(
          ...textRows(
            [...answer.selected, ...(answer.text ? [answer.text] : [])].join(
              ", ",
            ),
            columns,
          ).map((r) => ({ ...r, target: { kind: "edit" as const, index: i } })),
        );
      }
      return rows;
    }
    const rows: DialogRow[] = [];
    const q = this.q,
      d = this.state;
    if (this.request.questions)
      rows.push(
        ...textRows(
          `${this.request.question} · ${this.index + 1}/${this.questions.length}${q.header ? " · " + q.header : ""}`,
          columns,
          "muted",
        ),
      );
    rows.push(
      ...textRows(q.question, columns, "accent").map((r) => ({
        ...r,
        bold: true,
      })),
    );
    for (const [i, option] of (q.options ?? []).entries()) {
      const value = typeof option === "string" ? { label: option } : option;
      const active = d.focus === "options" && d.cursor === i;
      const marker = q.multi
        ? d.selected.has(i)
          ? "[✓]"
          : "[ ]"
        : d.selected.has(i)
          ? "●"
          : "○";
      rows.push(
        ...textRows(
          `${active ? "›" : " "} ${marker} ${i + 1}) ${value.label}${value.recommended ? " (Recommended)" : ""}`,
          columns,
        ).map((r) => ({
          ...r,
          bold: active,
          selected: active,
          target: { kind: "option" as const, index: i },
        })),
      );
      if (value.description)
        rows.push(
          ...textRows("    " + value.description, columns, "muted").map(
            (r) => ({ ...r, target: { kind: "option" as const, index: i } }),
          ),
        );
    }
    if (q.options?.length && this.other)
      rows.push(
        ...textRows(
          `${d.focus === "text" ? "›" : " "} ${d.text.trim() ? "●" : "○"} Other / write your own`,
          columns,
          "muted",
        ).map((r) => ({
          ...r,
          selected: d.focus === "text",
          target: { kind: "other" as const },
        })),
      );
    return rows;
  }
  private answerLine(columns: number) {
    const d = this.state, chars = Array.from(d.text);
    const prefix = columns >= 24 ? "Your answer: " : "Answer: ";
    const room = Math.max(1, columns - prefix.length - 1);
    const start = Math.max(0, d.textCursor - room + 1);
    const visible = chars.slice(start, start + room);
    visible.splice(d.textCursor - start, 0, "▏");
    if (start && visible.length > 1) visible[0] = "…";
    return prefix + visible.join("");
  }
  private footer(columns: number): DialogRow[] {
    const result: DialogRow[] = [];
    if (this.error) result.push(...textRows(this.error, columns, "danger"));
    if (!this.review) {
      const d = this.state;
      const prompt = d.numbers
        ? `Numbers: ${d.numbers}▏`
        : d.editing || !this.q.options?.length
          ? this.answerLine(columns)
          : this.q.multi
            ? "Space toggles choices"
            : "Enter chooses the focused option";
      result.push(...textRows(prompt, columns, "muted").slice(-1));
    }
    const buttons: DialogRow[] = this.review
      ? [
          {
            text: "[ Submit answers ]",
            bold: true,
            selected: this.reviewCursor === this.questions.length,
            tone: "accent",
            target: { kind: "submit" },
          },
        ]
      : [
          {
            text: this.request.questions ? "[ Next ]" : "[ Answer ]",
            bold: true,
            selected: this.state.focus === "next",
            tone: "accent",
            target: { kind: "next" },
          },
        ];
    if (this.index > 0)
      buttons.unshift({
        text: "[ Back ]",
        selected: !this.review && this.state.focus === "back",
        tone: "muted",
        target: { kind: "back" },
      });
    // Buttons occupy separate rows so narrow terminals retain accurate hit areas.
    result.push(...buttons);
    return result;
  }
  rows(columns: number): Row[] {
    return [...this.body(columns), ...this.footer(columns)];
  }
  visible(columns: number, height: number): Row[] {
    const body = this.body(columns),
      footer = this.footer(columns).slice(-Math.max(1, height - 1));
    const room = Math.max(1, height - footer.length);
    if (this.reveal) {
      const focus = body.findIndex((r) =>
        this.review
          ? r.target?.kind === "edit" && r.target.index === this.reviewCursor
          : r.selected,
      );
      if (focus >= 0) {
        if (focus < this.scroll) this.scroll = focus;
        if (focus >= this.scroll + room) this.scroll = focus - room + 1;
      }
      this.reveal = false;
    }
    this.scroll = Math.min(
      Math.max(0, this.scroll),
      Math.max(0, body.length - room),
    );
    const result = [
      ...body.slice(this.scroll, this.scroll + room),
      ...footer,
    ].slice(0, height);
    this.hits.clear();
    result.forEach((row, i) => {
      if (row.target) this.hits.set(i, row.target);
    });
    return result.map(({ target, ...row }) => row);
  }
  private choose(index: number) {
    const d = this.state;
    if (this.q.multi) {
      d.selected.has(index) ? d.selected.delete(index) : d.selected.add(index);
    } else {
      d.selected = new Set([index]);
      d.text = "";
      d.textCursor = 0;
    }
    d.numbers = "";
    d.cursor = index;
    d.editing = false;
    d.focus = "options";
    this.error = "";
    this.reveal = true;
  }
  private jump(index: number) {
    this.index = index;
    this.error = "";
    this.scroll = 0;
    this.reveal = true;
  }
  private validate() {
    const d = this.state,
      q = this.q,
      options = q.options ?? [];
    if (d.numbers) {
      const numbers = d.numbers.split(",").map((n) => Number(n.trim()));
      if (
        numbers.some(
          (n) => !Number.isInteger(n) || n < 1 || n > options.length,
        ) ||
        (!q.multi && numbers.length !== 1)
      ) {
        this.error = `Choose ${q.multi ? "numbers" : "one number"} from 1 to ${options.length}.`;
        return false;
      }
      d.selected = new Set(numbers.map((n) => n - 1));
      d.text = "";
      d.textCursor = 0;
      d.numbers = "";
    }
    if (!d.selected.size && !d.text.trim()) {
      this.error = "Choose an option or enter an answer.";
      return false;
    }
    if (d.text.length > 4000) {
      this.error = "Keep the answer within 4000 characters.";
      return false;
    }
    return true;
  }
  private finish(): {
    answer: UserQuestionAnswer;
  } {
    const result: QuestionnaireResult = {
      answers: this.questions.map((_q, i) => this.selectedAnswer(i)),
    };
    if (this.request.questions) return { answer: result };
    const a = result.answers[0],
      values = [...a.selected, ...(a.text ? [a.text] : [])];
    return { answer: this.questions[0].multi ? values : values[0] };
  }
  private next() {
    if (!this.validate()) return;
    if (!this.request.questions) return this.finish();
    this.jump(this.index + 1);
    if (this.review) this.reviewCursor = this.questions.length;
  }
  private action(target: Target) {
    if (target.kind === "back") {
      this.jump(this.index - 1);
      return;
    }
    if (target.kind === "submit") return this.finish();
    if (target.kind === "edit") {
      this.jump(target.index!);
      return;
    }
    if (target.kind === "next") return this.next();
    if (target.kind === "other") {
      const d = this.state;
      d.editing = true;
      d.focus = "text";
      d.numbers = "";
      if (!this.q.multi) d.selected.clear();
      this.error = "";
      this.reveal = true;
      return;
    }
    this.choose(target.index!);
  }
  handle(input: Input):
    | {
        answer: UserQuestionAnswer;
      }
    | "cancel"
    | undefined {
    if (input.kind === "mouse") {
      if (input.button === "wheel-down" || input.button === "wheel-up") {
        this.scroll += input.button === "wheel-down" ? 3 : -3;
        this.reveal = false;
        return;
      }
      if (input.action === "press" && input.button === "left") {
        const target = this.hits.get(input.row);
        if (target) return this.action(target);
      }
      return;
    }
    if (input.kind === "key" && input.key === "escape") return "cancel";
    if (input.kind === "key" && ["pageup", "pagedown"].includes(input.key)) {
      this.scroll += input.key === "pageup" ? -4 : 4;
      this.reveal = false;
      return;
    }
    if (this.review) {
      if (input.kind === "text" && input.text === " ")
        return this.reviewCursor === this.questions.length
          ? this.finish()
          : this.action({ kind: "edit", index: this.reviewCursor });
      if (
        input.kind === "text" &&
        /^[1-8]$/.test(input.text) &&
        Number(input.text) <= this.questions.length
      ) {
        this.jump(Number(input.text) - 1);
        return;
      }
      if (input.kind === "key") {
        if (input.key === "left" || input.key === "backspace") {
          this.jump(this.questions.length - 1);
          return;
        }
        if (["up", "down", "tab"].includes(input.key)) {
          this.reviewCursor =
            (this.reviewCursor +
              (input.key === "up" || input.key === "tab" && input.modifiers?.includes("shift") ? -1 : 1) +
              this.questions.length +
              1) %
            (this.questions.length + 1);
          this.reveal = true;
          return;
        }
        if (input.key === "enter" || input.key === "space")
          return this.reviewCursor === this.questions.length
            ? this.finish()
            : this.action({ kind: "edit", index: this.reviewCursor });
      }
      return;
    }
    const d = this.state,
      options = this.q.options ?? [];
    if (input.kind === "text") {
      if (input.text === " " && (d.focus === "back" || d.focus === "next"))
        return this.action({ kind: d.focus });
      const value = input.text.replace(/[\x00-\x1f\x7f]/g, " ");
      if (value === " " && !d.editing && !d.numbers && options.length) {
        this.choose(d.cursor);
        return;
      }
      if (!d.editing && options.length && /^[\d, ]+$/.test(value)) {
        d.numbers += value;
        this.error = "";
        return;
      }
      if (!this.other) {
        this.error = "Choose one of the available options.";
        return;
      }
      d.editing = true;
      d.focus = "text";
      if (!this.q.multi) d.selected.clear();
      const chars = Array.from(d.text);
      chars.splice(d.textCursor, 0, ...Array.from(value));
      d.text = chars.slice(0, 4001).join("");
      d.textCursor = Math.min(4001, d.textCursor + Array.from(value).length);
      d.numbers = "";
      this.error = "";
      return;
    }
    if (input.kind !== "key") return;
    if (d.editing && ["left", "right", "home", "end", "backspace", "delete"].includes(input.key)) {
      const chars = Array.from(d.text);
      if (input.key === "left") d.textCursor = Math.max(0, d.textCursor - 1);
      if (input.key === "right") d.textCursor = Math.min(chars.length, d.textCursor + 1);
      if (input.key === "home") d.textCursor = 0;
      if (input.key === "end") d.textCursor = chars.length;
      if (input.key === "backspace" && d.textCursor > 0) chars.splice(--d.textCursor, 1);
      if (input.key === "delete") chars.splice(d.textCursor, 1);
      d.text = chars.join("");
      this.error = "";
      return;
    }
    if (input.key === "backspace" || input.key === "delete") {
      if (d.numbers) d.numbers = d.numbers.slice(0, -1);
      this.error = "";
      return;
    }
    if (input.key === "left" && !d.editing && this.index > 0) {
      this.jump(this.index - 1);
      return;
    }
    if (input.key === "tab") {
      const focuses: Draft["focus"][] = [
        ...(options.length ? ["options" as const] : []),
        ...(this.other ? ["text" as const] : []),
        ...(this.index > 0 ? ["back" as const] : []),
        "next",
      ];
      d.focus = focuses[(focuses.indexOf(d.focus) + (input.modifiers?.includes("shift") ? -1 : 1) + focuses.length) % focuses.length];
      d.editing = d.focus === "text";
      this.reveal = true;
      return;
    }
    if ((input.key === "up" || input.key === "down") && options.length) {
      d.cursor =
        (d.cursor + (input.key === "up" ? -1 : 1) + options.length) %
        options.length;
      d.focus = "options";
      d.editing = false;
      d.numbers = "";
      this.reveal = true;
      return;
    }
    if (input.key === "space" && (d.focus === "back" || d.focus === "next"))
      return this.action({ kind: d.focus });
    if (input.key === "space" && d.editing) return this.handle({ kind: "text", text: " " });
    if (input.key === "space" && !d.editing && options.length) {
      this.choose(d.cursor);
      return;
    }
    if (input.key === "enter") {
      if (d.focus === "back") {
        this.jump(this.index - 1);
        return;
      }
      if (
        options.length &&
        d.focus === "options" &&
        !this.q.multi &&
        !d.numbers
      ) {
        this.choose(d.cursor);
      }
      return this.next();
    }
  }
}
