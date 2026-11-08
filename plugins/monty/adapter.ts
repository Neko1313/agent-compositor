import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export type HostFunction = (
  args: unknown[],
  signal: AbortSignal
) => unknown | Promise<unknown>;
export interface SandboxInput {
  language: string;
  code: string;
  inputs?: Record<string, unknown>;
  functions?: Record<string, unknown>;
  timeoutMs?: number;
  memoryBytes?: number;
}
export interface SandboxResult {
  output: unknown;
  stdout: string;
}

export async function runSandbox(
  input: SandboxInput,
  signal?: AbortSignal
): Promise<SandboxResult> {
  if (input.language !== "python")
    throw new Error("Monty supports language=python");
  if (typeof input.code !== "string" || input.code.length > 100000)
    throw new Error("Invalid sandbox code");
  if (signal?.aborted) throw new Error("Sandbox cancelled");
  const functions = input.functions ?? {};
  for (const [name, fn] of Object.entries(functions))
    if (!/^[A-Za-z_][A-Za-z_0-9]*$/.test(name) || typeof fn !== "function")
      throw new Error("Invalid host function");
  const timeoutMs = input.timeoutMs ?? 30000,
    memoryBytes = input.memoryBytes ?? 32000000;
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > 300000 ||
    !Number.isInteger(memoryBytes) ||
    memoryBytes < 1000000 ||
    memoryBytes > 128000000
  )
    throw new Error("Invalid sandbox resource limits");
  const request = JSON.stringify({
    code: input.code,
    inputs: input.inputs ?? {},
    names: Object.keys(functions),
    timeoutMs,
    memoryBytes,
  });
  if (Buffer.byteLength(request) > 1000000)
    throw new Error("Sandbox input exceeds 1 MB");
  return new Promise((accept, reject) => {
    const grouped = process.platform !== "win32";
    const executable =
      process.env.AGENT_NODE_BIN ||
      (process.versions.bun ? "node" : process.execPath);
    const proc = spawn(
      executable,
      [fileURLToPath(new URL("./worker.mjs", import.meta.url))],
      {
        cwd: fileURLToPath(new URL(".", import.meta.url)),
        detached: grouped,
        stdio: ["pipe", "pipe", "pipe"],
      }
    );
    const controller = new AbortController();
    let buffer = "",
      stderr = "",
      bytes = 0,
      result: SandboxResult | undefined,
      failure: Error | undefined;
    const stop = (error: Error) => {
      failure ??= error;
      controller.abort();
      try {
        if (grouped && proc.pid) process.kill(-proc.pid, "SIGKILL");
        else proc.kill("SIGKILL");
      } catch {
        proc.kill("SIGKILL");
      }
    };
    const abort = () => stop(new Error("Sandbox cancelled"));
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(
      () => stop(new Error(`Sandbox timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
    proc.stdin.on("error", () => {});
    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");
    proc.stderr.on("data", (chunk) => {
      if (stderr.length < 16000)
        stderr += chunk.toString().slice(0, 16000 - stderr.length);
    });
    proc.stdout.on("data", (chunk) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 2000000) {
        stop(new Error("Sandbox output exceeds limit"));
        return;
      }
      buffer += chunk.toString();
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        try {
          const message = JSON.parse(line);
          if (message.kind === "result") result = message.value;
          else if (message.kind === "error")
            failure = new Error(String(message.error));
          else if (message.kind === "call") {
            const fn = Object.hasOwn(functions, message.name)
              ? (functions[message.name] as HostFunction)
              : undefined;
            if (!fn || !Array.isArray(message.args))
              throw new Error("Unknown sandbox host call");
            void (async () => {
              let reply;
              try {
                if (controller.signal.aborted) return;
                const value = await fn(message.args, controller.signal);
                reply = { id: message.id, value: value ?? null };
              } catch (error) {
                reply = {
                  id: message.id,
                  error: error instanceof Error ? error.message : String(error),
                };
              }
              if (controller.signal.aborted || proc.stdin.destroyed) return;
              try {
                const text = JSON.stringify(reply);
                if (Buffer.byteLength(text) > 1000000)
                  throw new Error("Host result exceeds limit");
                proc.stdin.write(text + "\n");
              } catch (error) {
                stop(error as Error);
              }
            })();
          } else throw new Error("Invalid sandbox worker message");
        } catch (error) {
          stop(error as Error);
        }
      }
    });
    proc.on("error", (error) => {
      failure = error;
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      controller.abort();
      if (failure || code !== 0 || !result)
        reject(
          failure ??
            new Error(
              `Monty worker failed (${code}): ${stderr}. Run npm ci --prefix plugins/monty.`
            )
        );
      else accept(result);
    });
    // Keep stdin open for host-call replies until the worker exits.
    proc.stdin.write(request + "\n");
  });
}
