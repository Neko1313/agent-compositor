import type { Writable } from "node:stream";
import type { AgentCore, LoopEvent } from "@agent-compositor/core";

export interface ApprovalPrompt {
  tool: string;
  args: unknown;
  reason?: string;
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
    /** single-key approval source: y/n/a — injected for tests */
    private readonly promptKey: (question: string) => Promise<"y" | "n" | "a"> = defaultPromptKey,
  ) {}

  handleEvent(event: LoopEvent): void {
    if (event.kind === "text") {
      this.write(event.delta);
      return;
    }
    // catalog event: {event, input}
    const input = event.input as Record<string, unknown>;
    switch (event.event) {
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
  async askApproval(req: ApprovalPrompt): Promise<boolean> {
    this.write(`\n[permission] ${req.tool} ${truncate(JSON.stringify(req.args ?? {}), 80)}\n`);
    if (req.reason) this.write(`  reason: ${req.reason}\n`);
    const answer = await this.promptKey("Allow? [y=once / a=session / n=deny] ");
    return answer !== "n";
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

async function defaultPromptKey(question: string): Promise<"y" | "n" | "a"> {
  process.stdout.write(question);
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    rl.close();
    const c = line.trim().toLowerCase()[0];
    return c === "y" ? "y" : c === "a" ? "a" : "n";
  }
  return "n";
}
