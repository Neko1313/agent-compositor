import { readFile, stat } from "node:fs/promises";
import { join, dirname, relative, extname } from "node:path";
import { confinedPath, projectFiles } from "@agent-compositor/tools";
const MAX_CONTEXT = 120_000;
async function instructions(dir: string): Promise<string> {
  const parts: string[] = [];
  for (const name of ["AGENTS.md", "CLAUDE.md", "GEMINI.md"]) {
    try {
      const file = join(dir, name);
      const info = await stat(file);
      if (info.size < MAX_CONTEXT)
        parts.push(`# ${name}\n${await readFile(file, "utf8")}`);
    } catch {
      /* optional project convention */
    }
  }
  return parts.join("\n\n").slice(0, MAX_CONTEXT);
}
export async function projectInstructions(
  root: string,
  globalRoot?: string
): Promise<string> {
  return [
    globalRoot ? await instructions(globalRoot) : "",
    await instructions(root),
    await instructions(join(root, ".agent-compositor")),
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, MAX_CONTEXT);
}
export async function expandReferences(
  root: string,
  text: string
): Promise<{ text: string; images: { mimeType: string; data: string }[] }> {
  const images: { mimeType: string; data: string }[] = [];
  const parts = [text],
    dirs = new Set<string>();
  let used = text.length;
  for (const match of text.matchAll(/(?:^|\s)@(?:"([^"]+)"|([^\s]+))/g)) {
    const name = match[1] ?? match[2];
    if (!name || used >= MAX_CONTEXT) continue;
    try {
      const path = await confinedPath(root, name);
      const info = await stat(path);
      if (info.isDirectory()) {
        const files = (await projectFiles(root))
          .filter((f) => f.startsWith(relative(root, path) + "/"))
          .slice(0, 200);
        const content = `\nDirectory @${name}:\n${files.join("\n")}`;
        parts.push(content);
        used += content.length;
        continue;
      }
      const mime = (
        {
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".webp": "image/webp",
          ".gif": "image/gif",
        } as Record<string, string>
      )[extname(path).toLowerCase()];
      if (mime) {
        if (info.size > 10 * 1024 * 1024) throw new Error("Image exceeds 10MB");
        images.push({
          mimeType: mime,
          data: (await readFile(path)).toString("base64"),
        });
        parts.push(`Attached image @${name}`);
        continue;
      }
      if (info.size > MAX_CONTEXT || !info.isFile())
        throw new Error(`File exceeds ${MAX_CONTEXT} bytes`);
      let content = await readFile(path, "utf8");
      if (content.includes("\0"))
        throw new Error("Binary file: use --image for images");
      content = content.slice(0, MAX_CONTEXT - used);
      parts.push(`\n<file path=${JSON.stringify(name)}>\n${content}\n</file>`);
      used += content.length;
      let dir = dirname(path);
      while (relative(root, dir) && !relative(root, dir).startsWith("..")) {
        if (!dirs.has(dir)) {
          dirs.add(dir);
          const rules = await instructions(dir);
          if (rules) {
            parts.push(rules.slice(0, MAX_CONTEXT - used));
            used += rules.length;
          }
        }
        dir = dirname(dir);
      }
    } catch (error) {
      parts.push(`\nReference @${name}: ${String(error)}`);
    }
  }
  return { text: parts.join("\n"), images };
}
