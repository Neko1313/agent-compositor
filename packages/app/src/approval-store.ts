import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile, realpath } from "node:fs/promises";
import { join, dirname } from "node:path";
import { ApprovalSession, type Approval } from "@agent-compositor/permissions";
export async function approvalStore(
  root: string,
  home: string,
  globalRoot = join(home, ".agent-compositor")
): Promise<{
  session: ApprovalSession;
  save: (values: readonly Approval[]) => Promise<void>;
}> {
  const id = createHash("sha256")
    .update(await realpath(root))
    .digest("hex");
  const file = join(globalRoot, "approvals", `${id}.json`);
  const session = new ApprovalSession();
  try {
    const values: unknown = JSON.parse(await readFile(file, "utf8"));
    if (Array.isArray(values))
      session.restore(
        values.filter(
          (v) =>
            typeof v?.approvedAt === "number" &&
            ["tool", "command", "pattern", "path", "url"].every(
              (k) => v[k] === undefined || typeof v[k] === "string"
            )
        )
      );
  } catch {
    /* first run */
  }
  return {
    session,
    save: async (values) => {
      session.restore(values);
      await mkdir(dirname(file), { recursive: true, mode: 0o700 });
      await writeFile(file + ".tmp", JSON.stringify(values, null, 2), {
        mode: 0o600,
      });
      await rename(file + ".tmp", file);
    },
  };
}
