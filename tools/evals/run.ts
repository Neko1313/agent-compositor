import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCase, type EvalCase } from "./runner.js";
const args = process.argv.slice(2),
  value = (name: string, fallback: string) =>
    args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const models = value("--models", "scripted").split(","),
  repeat = Number(value("--repeat", "1")),
  suite = value(
    "--suite",
    fileURLToPath(new URL("./cases.json", import.meta.url))
  ),
  output = resolve(value("--output", "dist/evals"));
if (!Number.isInteger(repeat) || repeat < 1 || repeat > 20)
  throw Error("repeat must be 1..20");
const cases: EvalCase[] = JSON.parse(await readFile(suite, "utf8")),
  selected = cases.filter(
    (c) =>
      (!args.includes("--case") || c.id === value("--case", "")) &&
      (!args.includes("--split") || c.split === value("--split", ""))
  );
if (!selected.length) throw Error("No eval cases selected");
await mkdir(output, { recursive: true });
const results: any[] = [];
for (const model of models)
  for (let run = 0; run < repeat; run++)
    for (const test of selected) {
      const result = {
        ...(await runCase(test, {
          model,
          timeoutMs: Number(value("--timeout", "120000")),
          harness: args.includes("--harness")
            ? value("--harness", "")
            : undefined,
        })),
        run,
      };
      results.push(result);
      await writeFile(
        join(
          output,
          `${model.replace(/[^\w.-]/g, "_")}-${test.id}-${run}.json`
        ),
        JSON.stringify(result, null, 2)
      );
      console.log(
        `${result.ok ? "PASS" : "FAIL"} ${model} ${test.id} ${
          result.durationMs
        }ms${result.error ? " " + result.error : ""}`
      );
    }
const summary = {
  version: 1,
  createdAt: new Date().toISOString(),
  suite,
  repeat,
  models,
  passed: results.filter((r) => r.ok).length,
  total: results.length,
  passRate: results.filter((r) => r.ok).length / results.length,
  byModel: Object.fromEntries(
    models.map((model) => {
      const rows = results.filter((r) => r.model === model);
      return [
        model,
        {
          passed: rows.filter((r) => r.ok).length,
          total: rows.length,
          passRate: rows.filter((r) => r.ok).length / rows.length,
          meanDurationMs:
            rows.reduce((s, r) => s + r.durationMs, 0) / rows.length,
        },
      ];
    })
  ),
  results: results.map(({ trajectory, ...r }) => r),
};
if (args.includes("--baseline")) {
  const baseline = JSON.parse(await readFile(value("--baseline", ""), "utf8"));
  (summary as any).comparison = {
    baseline: value("--baseline", ""),
    passRateDelta: summary.passRate - baseline.passRate,
    regressions: summary.results
      .filter(
        (row) =>
          !row.ok &&
          baseline.results.some(
            (prior: any) =>
              prior.model === row.model && prior.id === row.id && prior.ok
          )
      )
      .map((row) => ({ model: row.model, id: row.id })),
  };
}
await writeFile(join(output, "report.json"), JSON.stringify(summary, null, 2));
console.log(
  JSON.stringify({
    passed: summary.passed,
    total: summary.total,
    passRate: summary.passRate,
  })
);
if (summary.passed !== summary.total) process.exitCode = 1;
