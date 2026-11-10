/**
 * guard-secrets — secret exfiltration guard.
 *
 * Catches the common shapes before they leave the machine: prompts are
 * dropped, tool arguments are denied. Local CLI agents ship something
 * like this for the same reason — one pasted env dump is one too many.
 */
const PATTERNS: { re: RegExp; label: string }[] = [
  { re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, label: "PEM private key" },
  { re: /\bAKIA[0-9A-Z]{16}\b/, label: "AWS access key id" },
  { re: /\bsk-[a-zA-Z0-9_-]{20,}\b/, label: "OpenAI-style API key" },
  { re: /\bgh[pousr]_[a-zA-Z0-9]{20,}\b/, label: "GitHub token" },
  { re: /\bxox[baprs]-[a-zA-Z0-9-]{10,}\b/, label: "Slack token" },
];

function scan(payload: string): string | undefined {
  for (const { re, label } of PATTERNS) {
    if (re.test(payload)) return label;
  }
  return undefined;
}

export default {
  "prompt.submit": async (event: { text: string }, $: any) => {
    const hit = scan(event.text);
    if (hit) {
      await $.ui.notify(`blocked: ${hit} detected in prompt — turn dropped`, "error");
      return { drop: `${hit} detected in prompt` };
    }
    return undefined;
  },

  "tool.call": async (event: { tool: string; input: unknown }, $: any) => {
    const hit = scan(JSON.stringify(event.input ?? {}));
    if (hit) {
      await $.ui.notify(`denied: ${event.tool} blocked — ${hit} in arguments`, "error");
      return { deny: `${hit} in arguments (guard-secrets)` };
    }
    return undefined;
  },
};
