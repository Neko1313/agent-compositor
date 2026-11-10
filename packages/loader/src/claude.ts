import { contained } from './paths.js';
import { readPluginMcp } from './mcp.js';
export { contained } from './paths.js';
import { readFile, readdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { spawn } from "node:child_process";
import type { UserHookFn } from "@agent-compositor/hooks";
import { diskManifestSchema } from "./manifest.js";
const readJson = async (file: string) =>
  JSON.parse(await readFile(file, "utf8"));
const names: Record<string, string> = {
  read: "Read",
  write: "Write",
  edit: "Edit",
  exec: "Bash",
  glob: "Glob",
  grep: "Grep",
  task: "Task",
  ask_user: "AskUserQuestion",
  todo: "TodoWrite",
};
const events: Record<string, string> = {
  SessionStart: "session.start",
  UserPromptSubmit: "prompt.submit",
  PreToolUse: "tool.check",
  PostToolUse: "tool.result",
  PostToolUseFailure: "tool.result",
  Stop: "turn.complete",
  StopFailure: "turn.failed",
  SubagentStart: "subagent.start",
  SubagentStop: "subagent.complete",
  PreCompact: "context.compacting",
  PostCompact: "context.compacted",
};
export async function claudeManifest(root: string) {
  const raw = await readJson(join(root, ".claude-plugin/plugin.json"));
  return diskManifestSchema.parse({
    name: raw.name ?? basename(root),
    version: raw.version ?? "0.0.0",
    description: raw.description,
    trust: "trusted",
  });
}
function markdown(raw: string) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  const fields: Record<string, string> = {};
  for (const line of (match?.[1] ?? "").split("\n")) {
    const m = line.match(/^([\w-]+):\s*(.*)$/);
    if (m) fields[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
  return { body: raw.slice(match?.[0].length ?? 0), fields };
}
async function command(
  command: string,
  input: any,
  cwd: string,
  root: string,
  signal: AbortSignal,
  timeout = 30
) {
  return new Promise<{ code: number; stdout: string; stderr: string }>(
    (accept, reject) => {
      const proc = spawn("/bin/sh", ["-c", command], {
        cwd,
        env: {
          ...process.env,
          CLAUDE_PLUGIN_ROOT: root,
          CLAUDE_PROJECT_DIR: cwd,
        },
        stdio: ["pipe", "pipe", "pipe"],
        detached: true,
      });
      let out = "",
        err = "",
        failure: Error | undefined;
      const stop = () => {
        try {
          if (proc.pid) process.kill(-proc.pid, "SIGKILL");
        } catch {
          proc.kill("SIGKILL");
        }
      };
      const abort = () => {
        failure = Error("Claude hook cancelled");
        stop();
      };
      const timer = setTimeout(() => {
        failure = Error("Claude hook timed out");
        stop();
      }, Math.min(Math.max(timeout, 1), 120) * 1000);
      proc.stdout.on("data", (chunk) => {
        out += chunk;
        if (out.length > 1000000) {
          failure = Error("Claude hook output exceeds limit");
          stop();
        }
      });
      proc.stderr.on("data", (chunk) => {
        err = (err + chunk).slice(-10000);
      });
      proc.once("error", reject);
      proc.once("close", (code) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        failure
          ? reject(failure)
          : accept({ code: code ?? -1, stdout: out, stderr: err });
      });
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      proc.stdin.on("error", () => {});
      proc.stdin.end(JSON.stringify(input));
    }
  );
}
/** Explicit compatibility subset. Unsupported executable components fail visibly. */
export async function loadClaudePlugin(root: string) {
  const raw = await readJson(join(root, ".claude-plugin/plugin.json")),
    manifest = await claudeManifest(root);
  for (const field of [
    "agents",
    "lspServers",
    "monitors",
    "channels",
    "userConfig",
  ])
    if (raw[field]) throw Error(`Claude component ${field} is not supported`);
  try {
    if (
      (await readdir(join(root, "agents"))).some((name) => name.endsWith(".md"))
    )
      throw Error("Claude agents require an explicit compositor adapter");
  } catch (e) {
    if ((e as any).code !== "ENOENT") throw e;
  }
  const commands = new Map<
    string,
    { body: string; description: string; usage?: string }
  >();
  const add = async (
    name: string,
    file?: string,
    inline?: string,
    description?: string,
    hint?: string
  ) => {
    if (!/^[a-z0-9][\w-]*$/.test(name))
      throw Error("Invalid Claude command name");
    const md = markdown(
      inline ?? (await readFile(await contained(root, file!), "utf8"))
    );
    commands.set(`/${manifest.name}:${name}`, {
      body: md.body,
      description: description ?? md.fields.description ?? name,
      usage: hint ?? md.fields["argument-hint"],
    });
  };
  const locations = async (path: string, skills = false) => {
    if (!skills && path.endsWith(".md")) {
      await add(basename(path, ".md"), path);
      return;
    }
    let entries;
    try {
      entries = await readdir(await contained(root, path), {
        withFileTypes: true,
      });
    } catch (e) {
      if ((e as any).code === "ENOENT") return;
      throw e;
    }
    for (const entry of entries) {
      if (skills && entry.isDirectory())
        await add(entry.name, join(path, entry.name, "SKILL.md"));
      else if (!skills && entry.isFile() && entry.name.endsWith(".md"))
        await add(entry.name.slice(0, -3), join(path, entry.name));
    }
  };
  await locations("commands");
  await locations("skills", true);
  if (raw.commands) {
    if (typeof raw.commands === "string") await locations(raw.commands);
    else if (Array.isArray(raw.commands)) {
      for (const path of raw.commands) {
        if (path.endsWith(".md")) await add(basename(path, ".md"), path);
        else await locations(path);
      }
    } else
      for (const [name, entry] of Object.entries(raw.commands) as [
        string,
        any
      ][])
        await add(
          name,
          entry.source,
          entry.content,
          entry.description,
          entry.argumentHint
        );
  }
  for (const path of typeof raw.skills === "string"
    ? [raw.skills]
    : raw.skills ?? [])
    await locations(path, true);
  const hookMap: Record<string, any[]> = {};
  const absorb = (value: any) => {
    for (const [name, groups] of Object.entries(value)) {
      if (!events[name]) throw Error(`Unsupported Claude hook event: ${name}`);
      if (!Array.isArray(groups)) throw Error("Invalid Claude hook groups");
      for (const group of groups)
        for (const hook of group.hooks ?? []) {
          if (hook.type !== "command" || hook.async)
            throw Error("Only synchronous Claude command hooks are supported");
          if (typeof hook.command !== "string")
            throw Error("Invalid hook command");
          if (group.matcher) new RegExp(group.matcher);
        }
      (hookMap[name] ??= []).push(...groups);
    }
  };
  try {
    absorb((await readJson(await contained(root, "hooks/hooks.json"))).hooks);
  } catch (e) {
    if ((e as any).code !== "ENOENT") throw e;
  }
  for (const entry of Array.isArray(raw.hooks)
    ? raw.hooks
    : raw.hooks
    ? [raw.hooks]
    : []) {
    if (typeof entry === "string")
      absorb((await readJson(await contained(root, entry))).hooks);
    else absorb(entry);
  }
  const mcpServers = await readPluginMcp(root, manifest.name, raw.mcpServers);
  const hooks: Record<string, UserHookFn> = {};
  for (const [claude, event] of Object.entries(events))
    if (hookMap[claude]) {
      const previous = hooks[event];
      hooks[event] = async (e: any, $) => {
        const before = await previous?.(e, $);
        if (before) return before;
        if (
          (claude === "PostToolUse" && !e.ok) ||
          (claude === "PostToolUseFailure" && e.ok)
        )
          return;
        const tool = names[e.tool] ?? e.tool ?? "";
        for (const group of hookMap[claude]) {
          if (group.matcher && !new RegExp(`^(?:${group.matcher})$`).test(tool))
            continue;
          for (const hook of group.hooks) {
            const result = await command(
              hook.command,
              {
                session_id: $.session.id,
                cwd: $.session.cwd,
                hook_event_name: claude,
                tool_name: tool,
                tool_input: e.input,
                tool_response: e.output,
                prompt: e.text,
                tool_use_id: e.callId,
              },
              $.session.cwd,
              root,
              $.signal,
              hook.timeout
            );
            if (result.code !== 0) {
              if (event === "tool.check")
                return {
                  decision: "deny",
                  reason: result.stderr || "Claude hook failed",
                };
              if (event === "prompt.submit")
                return { drop: result.stderr || "Claude hook blocked prompt" };
              throw Error(result.stderr || "Claude hook failed");
            }
            let output: any;
            try {
              output = JSON.parse(result.stdout);
            } catch {
              if (result.stdout.trim())
                await $.ui.notify(result.stdout.trim().slice(0, 2000), "info");
              continue;
            }
            const specific = output.hookSpecificOutput ?? {};
            if (specific.updatedInput !== undefined && event === "tool.check")
              return {
                decision: "deny",
                reason:
                  "Claude updatedInput hooks require an explicit compositor adapter",
              };
            if (
              output.continue === false ||
              output.decision === "block" ||
              specific.permissionDecision === "deny"
            ) {
              if (event === "tool.check")
                return {
                  decision: "deny",
                  reason:
                    specific.permissionDecisionReason ??
                    output.reason ??
                    output.stopReason ??
                    "Claude hook denied",
                };
              if (event === "prompt.submit")
                return { drop: output.reason ?? "Claude hook blocked" };
            }
            // Compatibility hooks may make policy stricter, never override an explicit host deny.
            if (event === "tool.check" && specific.permissionDecision === "ask")
              return {
                decision: "ask",
                reason: specific.permissionDecisionReason,
              };
            if (event === "prompt.submit" && specific.additionalContext)
              return { text: `${e.text}\n\n${specific.additionalContext}` };
          }
        }
      };
    }
  const prompt = hooks["prompt.submit"];
  hooks["prompt.submit"] = async (e: any, $) => {
    const response = await prompt?.(e, $);
    if (response) return response;
    const [name, ...args] = e.text.trim().split(/\s+/),
      cmd = commands.get(name);
    if (!cmd) return;
    let body = cmd.body
      .replaceAll("${CLAUDE_PLUGIN_ROOT}", root)
      .replaceAll("$ARGUMENTS", args.join(" "))
      .replace(/\$(\d+)/g, (_m, i) => args[Number(i) - 1] ?? "");
    return { text: body };
  };
  return {
    manifest: {
      ...manifest,
      commands: [...commands].map(([name, cmd]) => ({
        name,
        description: cmd.description,
        usage: cmd.usage ? `${name} ${cmd.usage}` : name,
      })),
    },
    hooks,
    mcpServers,
  };
}
