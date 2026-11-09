import type { AgentCoreOptions } from "@agent-compositor/core";
import type { WireMessage } from "@agent-compositor/protocol";
import { textRows, type Row } from "./presentation.js";
type Request = Parameters<NonNullable<AgentCoreOptions["onApproval"]>>[0];
type Input = Extract<WireMessage, { type: "input" }>["data"];
export interface ApprovalChoice {
  allow: boolean;
  scope: "once" | "session" | "project";
}
const choices = [
  { key: "y", label: "Y allow once", allow: true, scope: "once" },
  { key: "a", label: "A allow for session", allow: true, scope: "session" },
  { key: "p", label: "P allow for project", allow: true, scope: "project" },
  { key: "n", label: "N deny · Esc", allow: false, scope: "once" },
] as const;
/** Keep identity and permission scopes visible while the full action scrolls. */
export class ApprovalDialog {
  scroll = 0;
  focus = 3;
  private hits = new Map<number, number>();
  constructor(readonly request: Request) {}
  private details(columns: number): Row[] {
    const lines: Row[] = [];
    if (Array.from(this.request.tool).length + 6 > columns)
      lines.push(
        ...textRows(`Tool name: ${this.request.tool}`, columns, "warning"),
      );
    for (const [name, value] of Object.entries(this.request.descriptor)) {
      if (name === "tool" || value === undefined) continue;
      lines.push(
        ...textRows(
          `${name}: ${typeof value === "string" ? value : name === "command" && Array.isArray(value) ? value.join(" ") : JSON.stringify(value)}`,
          columns,
        ),
      );
    }
    if (this.request.reason)
      lines.push(
        { text: "" },
        ...textRows(this.request.reason, columns, "warning"),
      );
    return lines.length
      ? lines
      : [{ text: "No additional action details.", tone: "muted" }];
  }
  rows(columns: number): Row[] {
    return [
      { text: `Tool: ${this.request.tool}`, bold: true, tone: "warning" },
      ...this.details(columns),
      ...choices.map((c) => ({ text: `[ ${c.label} ]` })),
    ];
  }
  interactiveRow(row: number) {
    return this.hits.has(row);
  }
  visible(columns: number, height: number): Row[] {
    const footer = choices.map((choice, index) => ({
      text: `${index === this.focus ? "›" : " "} [ ${choice.label} ]`,
      selected: index === this.focus,
      tone: choice.allow ? ("text" as const) : ("warning" as const),
    }));
    const body = this.details(columns);
    const room = Math.max(1, height - footer.length - 1);
    this.scroll = Math.max(
      0,
      Math.min(this.scroll, Math.max(0, body.length - room)),
    );
    const header: Row = {
      text: `Tool: ${this.request.tool}${body.length > room ? ` · ${this.scroll + 1}-${Math.min(body.length, this.scroll + room)}/${body.length}` : ""}`,
      bold: true,
      tone: "warning",
    };
    const result = [
      header,
      ...body.slice(this.scroll, this.scroll + room),
      ...footer,
    ];
    this.hits.clear();
    footer.forEach((_r, index) =>
      this.hits.set(1 + Math.min(body.length, room) + index, index),
    );
    return result.slice(0, height);
  }
  handle(input: Input): ApprovalChoice | undefined {
    if (input.kind === "mouse") {
      if (input.button === "wheel-up" || input.button === "wheel-down") {
        this.scroll += input.button === "wheel-up" ? -3 : 3;
        return;
      }
      if (input.action === "press" && input.button === "left") {
        const index = this.hits.get(input.row);
        if (index !== undefined) {
          this.focus = index;
          return this.choose(index);
        }
      }
      return;
    }
    if (input.kind === "text") {
      const index = choices.findIndex(
        (c) => c.key === input.text.toLowerCase(),
      );
      if (index >= 0) return this.choose(index);
      if (input.text === " ") return this.choose(this.focus);
      return;
    }
    if (input.kind !== "key") return;
    if (input.key === "escape") return this.choose(3);
    const index = choices.findIndex((c) => c.key === input.key.toLowerCase());
    if (index >= 0) return this.choose(index);
    if (input.key === "pageup" || input.key === "pagedown") {
      this.scroll += input.key === "pageup" ? -5 : 5;
      return;
    }
    if (input.key === "home") {
      this.scroll = 0;
      return;
    }
    if (input.key === "end") {
      this.scroll = Number.MAX_SAFE_INTEGER;
      return;
    }
    if (["up", "down", "tab"].includes(input.key)) {
      this.focus =
        (this.focus +
          (input.key === "up" || input.modifiers?.includes("shift") ? -1 : 1) +
          choices.length) %
        choices.length;
      return;
    }
    if (input.key === "enter" || input.key === "space")
      return this.choose(this.focus);
  }
  private choose(index: number): ApprovalChoice {
    const c = choices[index];
    return { allow: c.allow, scope: c.scope };
  }
}
