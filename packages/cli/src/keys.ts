/**
 * Keystroke → intent decoder. Kept pure (no readline, no process) so the
 * whole input contract is unit-testable; the REPL wires it to a raw-mode
 * stdin. Semantics harvested from codex CLI muscle memory:
 *
 *  - idle:      Enter submits the buffered line
 *  - running:   Enter queues the line, Tab steers with it, Ctrl+C interrupts
 *  - idle:      Ctrl+C exits
 *  - anything:  Esc interrupts a running turn (and is otherwise ignored)
 */
export type KeyCommand =
  | { type: "char"; ch: string }
  | { type: "submit"; text: string }
  | { type: "steer"; text: string }
  | { type: "interrupt" }
  | { type: "exit" }
  | { type: "ignore" };

export interface DecoderState {
  /** text typed so far (the decoder owns the buffer) */
  line: string;
  /** is the agent mid-turn? flips Enter's meaning from submit to queue */
  running: boolean;
}

export function decodeKeys(data: string, state: DecoderState): KeyCommand[] {
  const commands: KeyCommand[] = [];
  for (const ch of data) {
    if (ch === "\r" || ch === "\n") {
      const text = state.line;
      state.line = "";
      commands.push(text.length === 0 && !state.running ? { type: "ignore" } : state.running ? { type: "steer", text } : { type: "submit", text });
      continue;
    }
    if (ch === "\t") {
      if (state.running && state.line.length > 0) {
        commands.push({ type: "steer", text: state.line });
        state.line = "";
      } else {
        commands.push({ type: "ignore" });
      }
      continue;
    }
    if (ch === "\x1b") {
      commands.push(state.running ? { type: "interrupt" } : { type: "ignore" });
      continue;
    }
    if (ch === "\x03") {
      // Ctrl+C: interrupt once, exit if already idle
      commands.push(state.running ? { type: "interrupt" } : { type: "exit" });
      continue;
    }
    if (ch === "\x7f" || ch === "\b") {
      state.line = state.line.slice(0, -1);
      commands.push({ type: "ignore" });
      continue;
    }
    if (ch >= " ") {
      state.line += ch;
      commands.push({ type: "char", ch });
    }
  }
  return commands;
}
