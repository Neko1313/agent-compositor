import type { Writable } from "node:stream";
import type { AgentCore, LoopEvent } from "@agent-compositor/core";

export interface ApprovalPrompt {
  tool: string;
  args: unknown;
  reason?: string;
  signal?:AbortSignal;
}

/**
 * Terminal rendering for LoopEvents. Design references: codex CLI's calm
 * single-stream layout and Claude Code's tool-line minimalism — one running
 * column of text, tool calls as compact one-liners, no boxes, no spinners.
 * All output goes through an injected Writable, so tests drive it with a
 * buffer.
 *
 * The LoopEvent wire is deliberately thin: catalog events arrive verbatim,
 * streamed text arrives as `text` deltas. This class maps both to lines.
 */
export class TerminalRenderer {
  constructor(
    private readonly out: Writable,
    /** line-based user input — raw-mode stdin or a test stub; returns the typed line */
    private readonly promptKey: (question: string,signal?:AbortSignal) => Promise<string> = defaultPromptKey,
  ) {}

  handleEvent(event: LoopEvent): void {
    if (event.kind === "text") {
      this.write(event.delta);
      return;
    }
    // catalog event: {event, input}
    const input = event.input as Record<string, unknown>;
    switch (event.event) {
      case 'ui.notification':
        this.write(`\n[${str(input.plugin??'notice')}] ${str(input.message)}\n`);
        break;
      case "tool.call":
        this.write(`\n  ⚙ ${str(input.tool)} ${truncate(JSON.stringify(input.input ?? {}), 72)}`);
        break;
      case "tool.result": {
        if (input.ok !== true) {
          this.write(`\n  ✗ ${str(input.tool)}: ${truncate(str(input.error ?? "unknown error"), 120)}`);
        }
        // ok results stay silent — the assistant's next text narrates them
        break;
      }
      case "turn.start":
        break;
      case "turn.complete":
        this.write("\n");
        break;
      case "turn.interrupted":
        this.write("\n[interrupted]\n");
        break;
      case "turn.failed":
        this.write(`\n[turn error: ${truncate(str(input.error), 200)}]\n`);
        break;
      case "context.compacted": {
        const folded = typeof input.foldedCount === "number" ? input.foldedCount : "?";
        this.write(`\n[~ context compacted — ${folded} messages folded]\n`);
        break;
      }
      case "prompt.queued":
        this.write(`\n[queued]\n`);
        break;
      default:
        break; // tool.check, turn.step, assistant.text, service.* — logged by the roll, not rendered
    }
  }

  /** Subscribe to a live core. Returns the unsubscribe handle. */
  attach(core: AgentCore): () => void {
    return core.subscribe((ev) => this.handleEvent(ev));
  }

  /** The approval dialog shown when the permission layer escalates. */
  async askApproval(req: ApprovalPrompt): Promise<boolean | {allow: boolean; scope: "session" | "project"}> {
    this.write(`\n[permission] ${req.tool} ${truncate(JSON.stringify(req.args ?? {}), 80)}\n`);
    if (req.reason) this.write(`  reason: ${req.reason}\n`);
    const answer = (await this.promptKey("Allow? [y=once / a=session / p=project / n=deny] ",req.signal)).trim().toLowerCase();
    if (answer.startsWith("a") || answer.startsWith("p")) return { allow: true, scope: answer.startsWith("p") ? "project" : "session" };
    return answer.startsWith("y");
  }

  /** The AskUserQuestion dialog: numbered options or free text. */
  async askUser(req: { question: string; options?: string[]; multi?: boolean;signal?:AbortSignal }): Promise<string | string[]> {
    this.write(`\n[question] ${req.question}\n`);
    const options = (req.options ?? []).filter((o): o is string => typeof o === "string");
    if (options.length === 0) {
      return (await this.promptKey("answer: ",req.signal)).trim();
    }
    options.forEach((o, i) => this.write(`  ${i + 1}) ${o}\n`));
    const hint = req.multi ? "answer: numbers, comma-separated (e.g. 1,3) " : "answer: number ";
    const line = (await this.promptKey(hint,req.signal)).trim();
    const picks = line
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= options.length);
    const answers = picks.map((n) => options[n - 1]);
    return req.multi === true ? answers : answers[0] ?? "";
  }

  private write(s: string): void {
    this.out.write(s);
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v : String(v ?? "");
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

async function defaultPromptKey(question: string): Promise<string> {
  process.stdout.write(question);
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    rl.close();
    return line;
  }
  return "";
}
