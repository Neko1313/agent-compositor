import metadata from "../package.json" with { type: "json" };
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { runHeadless } from "./headless.js";
import { runTui } from "./tui.js";
import { runRepl } from "@agent-compositor/cli";
import type { AgentCore } from "@agent-compositor/core";
import { buildApp } from "./build.js";

export interface MainOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  argv?: string[];
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
  /** test hook: scripted provider instead of env/config-derived */
  provider?: ConstructorParameters<typeof AgentCore>[0]["provider"];
}

/**
 * The `compositor` binary: flags → buildApp → REPL.
 *
 *   compositor [--plugins dir ...] [--resume [ID]] [--history] [--cwd dir] [--plain]
 *
 * Provider comes from env (AGENT_BASE_URL / AGENT_API_KEY / AGENT_MODEL) or
 * config (`providers.default`, `model`). Exits 2 on unknown flags.
 */
export async function main(options: MainOptions = {}): Promise<number> {
  let cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const argv = options.argv ?? process.argv.slice(2);
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;

  if (argv.length === 1 && ["--version", "-v"].includes(argv[0])) {
    stdout.write(`compositor ${metadata.version}\n`);
    return 0;
  }
  if (argv.length === 1 && ["--help", "-h"].includes(argv[0])) {
    stdout.write(`Usage: compositor [options]

  --cwd DIR               Primary project directory
  --add-dir DIR           Attach another working directory (repeatable)
  --plugins DIR           Additional plugin directory (repeatable)
  --resume [ID]           Resume a session or open interactive history
  --history               Open interactive chat history
  --plain                 Use the line-based interface
  -p, --prompt TEXT       Run a prompt without the TUI (- reads stdin)
  -i, --image FILE        Attach an image (repeatable)
  --model NAME            Select a model
  --max-steps N           Limit agent steps
  --output-format FORMAT  text, json or stream-json
  --output-schema FILE    Validate structured output against a JSON schema
  -v, --version           Print the version
  -h, --help              Print this help
`);
    return 0;
  }

  const pluginDirs: string[] = [];
  const workspacePaths:string[]=[];
  let plain = false;
  let historyPicker = false;
  let prompt: string | undefined, schemaFile: string | undefined;
  let format: 'text' | 'json' | 'stream-json' = 'text';
  let maxSteps: number | undefined;
  let model: string | undefined;
  const imageFiles: string[] = [];
  let resumeSessionId: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--image' || arg === '-i') { const path = argv[++i]; if (!path) return fail(stdout, '--image needs a file'); imageFiles.push(path);
    } else if (arg === '--prompt' || arg === '-p') { prompt = argv[++i]; if (prompt === undefined) return fail(stdout, '--prompt needs text (or - for stdin)');
    } else if (arg === '--output-format') { const value = argv[++i]; if (!['text', 'json', 'stream-json'].includes(value)) return fail(stdout, 'Invalid output format'); format = value as typeof format;
    } else if (arg === '--output-schema') { schemaFile = argv[++i]; if (!schemaFile) return fail(stdout, '--output-schema needs a JSON schema file');
    } else if (arg === '--max-steps') { maxSteps = Number(argv[++i]); if (!Number.isInteger(maxSteps) || maxSteps < 1) return fail(stdout, '--max-steps must be a positive integer');
    } else if (arg === '--model') { model = argv[++i]; if (!model) return fail(stdout, '--model needs a model name');
    } else if(arg==='--add-dir'){const dir=argv[++i];if(!dir)return fail(stdout,'--add-dir needs a directory');workspacePaths.push(dir);
    } else if (arg === "--plain") { plain = true;
    } else if (arg === "--plugins") {
      const dir = argv[++i];
      if (!dir) return fail(stdout, "--plugins needs a directory");
      pluginDirs.push(dir);
    } else if (arg === "--resume") {
      if(argv[i+1]&&!argv[i+1].startsWith('-'))resumeSessionId=argv[++i];
      else historyPicker=true;
    } else if(arg==='--history') {
      historyPicker=true;
    } else if (arg === "--cwd") {
      const dir = argv[++i];
      if (!dir) return fail(stdout, "--cwd needs a directory");
      cwd = dir;
    } else {
      return fail(stdout, `unknown flag: ${arg}`);
    }
  }

  if (prompt === '-') { prompt = ''; for await (const chunk of stdin) prompt += String(chunk); }
  if ((schemaFile || format !== 'text') && prompt === undefined) return fail(stdout, 'Structured output requires --prompt');
  if(historyPicker&&(plain||prompt!==undefined||!stdin.isTTY||!stdout.isTTY))return fail(stdout,'Interactive history requires a terminal; use --resume ID for noninteractive runs');
  const images = await Promise.all(imageFiles.map(async file => {
    const path = resolve(cwd, file), mimeType = ({ '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.gif':'image/gif' } as Record<string,string>)[extname(path).toLowerCase()];
    if (!mimeType) throw new Error('Unsupported image type');
    const bytes = await readFile(path); if (bytes.length > 10 * 1024 * 1024) throw new Error('Image exceeds 10MB');
    return { mimeType, data: bytes.toString('base64') };
  }));
  const app = await buildApp({ cwd,workspacePaths, images, env: model ? { ...env, AGENT_MODEL: model } : env, pluginDirs, resumeSessionId, provider: options.provider, maxSteps });
  if (prompt !== undefined) { try { return await runHeadless(app, prompt, format, text => { stdout.write(text); }, schemaFile); } finally { await app.close(); } }

  if (!plain && stdin.isTTY && stdout.isTTY) {
    await runTui(app, stdin, stdout, historyPicker ? "/history" : undefined);
    return 0;
  }
  if (app.pluginErrors.length > 0) {
    stdout.write("plugin load errors (skipped):\n");
    for (const e of app.pluginErrors) stdout.write(`  ${e.dir}: ${e.error}\n`);
  }
  if (app.plugins.length > 0) {
    stdout.write(`plugins: ${app.plugins.map((p) => `${p.manifest.name}@${p.manifest.version}`).join(", ")}\n`);
  }
  if (app.resumedEvents.length > 0) {
    stdout.write(`resumed: ${app.resumedEvents.length} events replayed\n`);
  }

  try { await runRepl({ createCore: app.createCore, stdin: stdin as never, stdout: stdout as never }); } finally { await app.close(); }
  return 0;
}

function fail(stdout: NodeJS.WriteStream, message: string): number {
  stdout.write(`compositor: ${message}\nusage: compositor [--plugins dir ...] [--resume [ID]] [--history] [--cwd dir] [--plain] [-p prompt] [--output-format text|json|stream-json]\n`);
  return 2;
}
