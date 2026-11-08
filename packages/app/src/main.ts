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
 *   compositor [--plugins dir ...] [--resume sessionId] [--cwd dir]
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

  const pluginDirs: string[] = [];
  let resumeSessionId: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--plugins") {
      const dir = argv[++i];
      if (!dir) return fail(stdout, "--plugins needs a directory");
      pluginDirs.push(dir);
    } else if (arg === "--resume") {
      resumeSessionId = argv[++i];
      if (!resumeSessionId) return fail(stdout, "--resume needs a session id");
    } else if (arg === "--cwd") {
      const dir = argv[++i];
      if (!dir) return fail(stdout, "--cwd needs a directory");
      cwd = dir;
    } else {
      return fail(stdout, `unknown flag: ${arg}`);
    }
  }

  const app = await buildApp({ cwd, env, pluginDirs, resumeSessionId, provider: options.provider });

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

  await runRepl({ createCore: app.createCore, stdin: stdin as never, stdout: stdout as never });
  return 0;
}

function fail(stdout: NodeJS.WriteStream, message: string): number {
  stdout.write(`compositor: ${message}\nusage: compositor [--plugins dir ...] [--resume sessionId] [--cwd dir]\n`);
  return 2;
}
