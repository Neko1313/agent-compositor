// Pre-write checkpoints (Claude Code rewind analog). Every write/edit call
// snapshots the previous file content (in plugin state, mirrored to disk);
// /rewind restores the most recent snapshot.
interface Snapshot {
  ts: number;
  path: string;
  content: string;
}

const JOURNAL = ".agent-compositor/checkpoints.json";
const CAP = 100;

async function readJournal($: any): Promise<Snapshot[]> {
  const raw = await $.fs.read(JOURNAL).catch(() => undefined);
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Snapshot[]) : [];
  } catch {
    return [];
  }
}

async function writeJournal($: any, snaps: Snapshot[]): Promise<void> {
  await $.fs.write(JOURNAL, JSON.stringify(snaps.slice(-CAP), null, 2));
}

export default {
  "tool.call": async (event: { tool: string; input?: unknown }, $: any) => {
    if (event.tool !== "write" && event.tool !== "edit") return;
    const p = (event.input ?? {}) as { path?: unknown };
    if (typeof p.path !== "string" || !p.path) return;
    const prev = await $.fs.read(p.path).catch(() => undefined);
    if (typeof prev !== "string") return; // new file: nothing to restore
    const snaps = await readJournal($);
    snaps.push({ ts: Date.now(), path: p.path, content: prev });
    await writeJournal($, snaps);
  },
  "prompt.submit": async (event: { text: string }, $: any) => {
    if (event.text !== "/rewind") return;
    const snaps = await readJournal($);
    if (snaps.length === 0) {
      void $.ui.notify("checkpoints: journal is empty — nothing to rewind", "warn");
      return { drop: "checkpoints: nothing to rewind" };
    }
    const last = snaps[snaps.length - 1];
    await $.fs.write(last.path, last.content);
    await writeJournal($, snaps.slice(0, -1));
    void $.ui.notify(`checkpoints: restored ${last.path} (journal: ${snaps.length - 1} left)`, "info");
    return { drop: "checkpoints: rewound" };
  },
};
