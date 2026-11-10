"""Compositor cases implementing the real upstream Harness² BenchmarkAdapter.

Scripted HTTP runs test integration; --model selects live model behavior. The
judge and scripts remain outside the agent workspace. This is not an OS sandbox.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from dataclasses import asdict
from hashlib import sha256
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import time
from urllib.parse import urlsplit

from harness2.core import tree as HT, runmark as RM
from harness2.core.judge import judge_one
from harness2.core.spec import BenchmarkAdapter, BenchPrompts, BenchSpec, ChannelSpec
from harness2_adapter import CompositorSubstrate, ROOT, SURFACE, fixture_path, isolated_env, substitute

CASES = Path(__file__).with_name("harness2-cases.json")


def runtime_fingerprint():
    digest = sha256()
    files = [ROOT / "package-lock.json"]
    for directory in (ROOT / "packages", ROOT / "plugins"):
        files.extend(path for path in directory.rglob("*") if path.is_file()
                     and path.suffix in (".ts", ".js", ".mjs", ".json")
                     and not {"test", "tests", "node_modules", "bin", "dist"}.intersection(path.relative_to(ROOT).parts))
    for path in sorted(files):
        digest.update(str(path.relative_to(ROOT)).encode() + b"\0" + path.read_bytes() + b"\0")
    return digest.hexdigest()


def read_events(run: Path) -> list[dict]:
    events = []
    for line in (run / "trajectory.jsonl").read_text().splitlines():
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(item, dict):
            events.append(item)
    return events


def argument_matches(key, actual, expected, run):
    if key in ("path", "cwd") and isinstance(actual, str) and isinstance(expected, str):
        def canonical(value):
            if value == "~" or value.startswith("~/"):
                value = str(run / "home") + value[1:]
            return (run / "workspace" / value).resolve()
        return canonical(actual) == canonical(expected)
    return actual == expected


def grade(run: Path, case: dict) -> dict:
    """Grade effects and correlated tool results, never a success claim alone."""
    events = read_events(run)
    execution = json.loads((run / "execution.json").read_text())
    runtime_root = Path(execution.get("run_root", run))
    results = [e for e in events if e.get("type") == "result"]
    calls = {e["input"]["callId"]: e["input"] for e in events
             if e.get("event") == "tool.call" and "callId" in e.get("input", {})}
    tools = [e["input"] for e in events if e.get("event") == "tool.result"]
    checks = []

    def check(name, ok):
        checks.append({"name": name, "ok": bool(ok)})

    check("process completed", execution.get("returncode") == 0 and not execution.get("error"))
    check("final result", len(results) == 1 and not results[0].get("error") and bool(results[0].get("response", "").strip()))
    capture = json.loads((run / "http.json").read_text()) if (run / "http.json").exists() else {"requests": [], "model": []}
    expected = substitute(case["expect"], {"origin": capture.get("origin", ""), "workspace": str(runtime_root / "workspace"), "home": str(runtime_root / "home")})
    for index, required in enumerate(expected.get("tools", [])):
        names = required["tool"] if isinstance(required["tool"], list) else [required["tool"]]
        candidates = [r for r in tools if r.get("tool") in names
                      and r.get("ok") is required["ok"]
                      and calls.get(r.get("callId"), {}).get("tool") == r.get("tool")
                      and all(argument_matches(k, calls[r["callId"]].get("input", {}).get(k), v, runtime_root) for k, v in required.get("args", {}).items())]
        check(f"tool {index + 1}: {required['tool']} ok={required['ok']}", any(
            all(token in json.dumps(result.get("output", {}), ensure_ascii=False) for token in required.get("outputIncludes", []))
            and all(token.lower() in str(result.get("error", "")).lower() for token in required.get("errorIncludes", []))
            for result in candidates))
    for scope, field in (("workspace", "files"), ("home", "home_files")):
        for name, content in expected.get(field, {}).items():
            try:
                path = fixture_path(run / scope, name)
            except ValueError:
                check(f"{scope}/{name}", False)
                continue
            check(f"{scope}/{name}", not path.exists() if content is None else path.is_file() and path.read_text() == content)
    for name, tokens in expected.get("fileIncludes", {}).items():
        try:
            path = fixture_path(run / "workspace", name)
            check(f"workspace/{name} evidence", path.is_file() and all(token in path.read_text() for token in tokens))
        except ValueError:
            check(f"workspace/{name} evidence", False)
    for probe in expected.get("nodeChecks", []):
        # The verification expression stays outside the rollout's filesystem scope.
        try:
            source = fixture_path(run / "workspace", probe["file"])
        except ValueError:
            check("independent artifact behavior", False)
            continue
        if not source.is_file():
            check("independent artifact behavior", False)
            continue
        with tempfile.TemporaryDirectory(prefix="compositor-judge-") as temp:
            directory = Path(temp)
            shutil.copy2(source, directory / "subject.mjs")
            try:
                result = subprocess.run(["node", "--input-type=module", "-e",
                                         "import * as m from './subject.mjs'; if (!(" + probe["expression"] + ")) process.exit(1);"],
                                        cwd=directory, env=isolated_env(directory, "judge", ""),
                                        capture_output=True, timeout=5)
                check("independent artifact behavior", result.returncode == 0)
            except subprocess.TimeoutExpired:
                check("independent artifact behavior", False)
    response = results[0].get("response", "") if len(results) == 1 else ""
    for text in expected.get("responseIncludes", []):
        check(f"answer contains {text}", text.lower() in response.lower())
    for path in expected.get("httpPaths", []):
        check(f"requested {path}", any(urlsplit(r).path == path for r in capture["requests"]))
    for path in expected.get("noHttpPaths", []):
        check(f"did not request {path}", all(urlsplit(r).path != path for r in capture["requests"]))
    for token in expected.get("privateTokens", []):
        check("private content absent from model input and trajectory", token not in json.dumps(capture["model"]) and token not in json.dumps(events))
    if "maxToolCalls" in expected:
        check("bounded tool calls", len(calls) <= expected["maxToolCalls"])
    for name in expected.get("forbiddenTools", []):
        check(f"did not use {name}", all(c.get("tool") != name for c in calls.values()))
    passed = sum(item["ok"] for item in checks)
    return {"n_passed": passed, "n_criteria": len(checks), "all_pass": passed == len(checks), "checks": checks}


@contextmanager
def fixture_server(case: dict, scripted: bool):
    """Serve real loopback HTTP and OpenAI-compatible SSE, with an audit log."""
    capture = {"requests": [], "model": [], "errors": []}
    steps = iter(case.get("script", []))

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def reply(self, status, body, content_type="application/json", headers=None):
            data = body.encode()
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            for key, value in (headers or {}).items():
                self.send_header(key, value)
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            capture["requests"].append(self.path)
            route = case.get("http", {}).get(urlsplit(self.path).path)
            if route is None:
                self.reply(404, "{}")
                return
            route = substitute(route, {"origin": origin})
            self.reply(route.get("status", 200), route["body"], route.get("type", "application/json"), route.get("headers"))

        def do_POST(self):
            if not scripted or self.path != "/v1/chat/completions":
                self.reply(404, "{}")
                return
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            capture["model"].append(body)
            step = substitute(next(steps, {"error": "Script exhausted before completion"}), {"origin": origin})
            observed = json.dumps(body.get("messages", []), ensure_ascii=False)
            missing = [token for token in step.get("requires", []) if token not in observed]
            if missing or step.get("error"):
                error = step.get("error") or f"Required observation missing: {missing}"
                capture["errors"].append(error)
                self.reply(400, json.dumps({"error": {"message": error}}))
                return
            delta = {"content": step.get("text", "")} if "calls" not in step else {"tool_calls": [
                {"index": i, "id": f"fixture_{len(capture['model'])}_{i}", "type": "function",
                 "function": {"name": call["name"], "arguments": json.dumps(call["args"])}}
                for i, call in enumerate(step["calls"])]}
            chunks = [{"choices": [{"delta": delta}]},
                      {"choices": [{"delta": {}, "finish_reason": "tool_calls" if "calls" in step else "stop"}],
                       "usage": {"prompt_tokens": 100, "completion_tokens": 20}}]
            self.reply(200, "".join("data: " + json.dumps(chunk) + "\n\n" for chunk in chunks) + "data: [DONE]\n\n", "text/event-stream")

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    origin = f"http://127.0.0.1:{server.server_port}"
    capture["origin"] = origin
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield origin, capture
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


class CompositorBenchmark:
    def __init__(self, root: Path, *, cases=CASES, model="scripted", base_url="http://127.0.0.1:11434/v1", harness=None):
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.cases = json.loads(Path(cases).read_text())
        ids = [case["id"] for case in self.cases]
        if len(ids) != len(set(ids)) or not ids:
            raise ValueError("Cases must have unique ids and cannot be empty")
        for case in self.cases:
            if not isinstance(case["id"], str) or case["id"] in (".", "..", "") or Path(case["id"]).name != case["id"]:
                raise ValueError("Case ids must be plain directory names")
            if case.get("split") not in ("train", "test") or not isinstance(case.get("expect"), dict) or not case["expect"]:
                raise ValueError("Every case needs a train/test split and observable expectations")
        self.model, self.base_url = model, base_url
        self.runtime_fingerprint = runtime_fingerprint()
        self.substrate = CompositorSubstrate(model=model, base_url=base_url, plugin_dirs=[ROOT / "plugins/web"])
        channel = ChannelSpec("opencode", "local/deterministic")
        self.spec = BenchSpec(name="compositor-workspaces-web", runs_root=self.root, install_mode="workspace_config",
                              prompts=BenchPrompts(work="work across selected projects and verify information from sources"),
                              channels={"proposer": channel, "selector": channel}, leak_globs=("*.grade.json", "*cases.json", "http.json"))
        self._base = Path(harness).resolve() if harness else self.root / "base"
        if not harness:
            HT.write_tree(SURFACE, {key: "" for key in SURFACE.always_on}, self._base, stubs=False)
        self.validate_tree(HT.read_tree(SURFACE, self._base))

    def case(self, task_id):
        return next(case for case in self.cases if case["id"] == task_id)

    def tasks(self, split="all"):
        if split not in ("all", "train", "test"):
            raise ValueError("Unknown split")
        return [case["id"] for case in self.cases if split == "all" or case["split"] == split]

    def domain_of(self, task_id):
        return self.case(task_id)["domain"]

    def task_prompt(self, task_id):
        return self.case(task_id)["prompt"]

    def task_files(self, task_id):
        source = self.root / "sources" / task_id
        source.mkdir(parents=True, exist_ok=True)
        for name, text in self.case(task_id).get("files", {}).items():
            path = fixture_path(source, name)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
        return source

    def base_harness(self):
        return self._base

    def validate_tree(self, tree):
        HT.validate(SURFACE, tree)

    def execute(self, task_id, harness_dir, run_id, *, timeout=None):
        fixture_path(self.root, run_id)
        case = self.case(task_id)
        harness = harness_dir or self.base_harness()
        identity = sha256(json.dumps([case, RM.fingerprint(harness), self.model, self.base_url, timeout, self.runtime_fingerprint,
                                     Path(__file__).read_text(), Path(__file__).with_name("harness2_adapter.py").read_text()], sort_keys=True).encode()).hexdigest()
        cache = self.root / (run_id + ".run.json")
        if cache.exists():
            record = json.loads(cache.read_text())
            if record["identity"] != identity:
                raise ValueError("Run id already belongs to a different task, harness or configuration")
            if not Path(record["run_dir"]).is_dir():
                raise ValueError("Cached rollout removed; use a new output directory")
            return Path(record["run_dir"])
        with fixture_server(case, self.model == "scripted") as (origin, capture):
            visible = substitute({k: v for k, v in case.items() if k in ("prompt", "files", "home_files", "symlinks", "add_dirs")}, {"origin": origin})
            rules = substitute(case.get("rules", []), {"origin": origin}) + [
                {"tool": "write", "path": "{{workspace}}/**", "decision": "allow"},
                {"tool": "edit", "path": "{{workspace}}/**", "decision": "allow"},
                {"tool": "web_fetch", "url": urlsplit(origin).netloc + "/", "decision": "allow"},
                {"tool": "web_search", "decision": "allow"},
            ]
            visible.setdefault("files", {})["agent-compositor.json"] = json.dumps({
                "permissions": {"rules": rules}, "compaction": {"enabled": False},
                "agent": {"skills": False, "projectContext": False},
            })
            if "http" in case:
                visible["files"][".agent-compositor/web.json"] = json.dumps({"provider": "searxng", "searchUrl": origin + "/search"})
            substrate = CompositorSubstrate(model=self.model, base_url=origin + "/v1" if self.model == "scripted" else self.base_url,
                                            plugin_dirs=self.substrate.plugin_dirs)
            install = substrate.materialise(harness, self.spec, {})
            task_file = self.root / (run_id + ".task.json")
            task_file.write_text(json.dumps(visible))
            try:
                run = substrate.execute(str(task_file), install, [run_id], timeout or 120)[0]
                (run / "http.json").write_text(json.dumps(capture, indent=2))
                # Execution must not inherit project config from an output directory
                # inside a checkout. Retain an archive only after the CLI has exited.
                archive = self.root / "captures" / run_id
                shutil.copytree(run, archive, symlinks=True)
                shutil.rmtree(run)
                run = archive
            finally:
                shutil.rmtree(install.staging_dir)
            cache.write_text(json.dumps({"identity": identity, "run_dir": str(run)}))
            return run

    def delivered(self, run_dir):
        return any(e.get("type") == "result" and not e.get("error") and e.get("response", "").strip() for e in read_events(run_dir))

    def trajectory(self, run_dir, *, obs_trunc):
        return self.substrate.read_trajectory(run_dir / "trajectory.jsonl", obs_trunc=obs_trunc, max_chars=100_000)

    def deliverable_text(self, run_dir):
        return "\n".join(e.get("response", "") for e in read_events(run_dir) if e.get("type") == "result")

    def deliverable_files(self, run_dir):
        return {"answer.txt": self.deliverable_text(run_dir)}

    def score(self, run_dir, task_id):
        return grade(run_dir, self.case(task_id))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases", type=Path, default=CASES)
    parser.add_argument("--output", type=Path, default=ROOT / "dist/harness2-cases")
    parser.add_argument("--model", default="scripted")
    parser.add_argument("--base-url", default="http://127.0.0.1:11434/v1")
    parser.add_argument("--split", choices=("all", "train", "test"), default="all")
    parser.add_argument("--case", action="append", dest="case_ids")
    parser.add_argument("--harness", type=Path)
    parser.add_argument("--repeat", type=int, choices=range(1, 21), default=1)
    parser.add_argument("--timeout", type=int, default=120)
    args = parser.parse_args()
    if args.timeout <= 0:
        parser.error("--timeout must be positive")
    bench = CompositorBenchmark(args.output, cases=args.cases, model=args.model, base_url=args.base_url, harness=args.harness)
    assert isinstance(bench, BenchmarkAdapter)
    bench.substrate.preflight()
    selected = bench.tasks(args.split)
    if args.case_ids:
        unknown = set(args.case_ids) - set(selected)
        if unknown:
            parser.error(f"Cases absent from selected split: {sorted(unknown)}")
        selected = [task for task in selected if task in args.case_ids]
    if not selected:
        parser.error("No cases selected")
    report = {"model": args.model, "mode": "scripted-integration" if args.model == "scripted" else "live-model",
              "split": args.split, "harness_fingerprint": RM.fingerprint(bench.base_harness()),
              "cases_fingerprint": sha256(args.cases.read_bytes()).hexdigest(),
              "runtime_fingerprint": bench.runtime_fingerprint, "runs": []}
    (bench.root / "cases.manifest.json").write_text(json.dumps(bench.cases, indent=2))
    for task_id in selected:
        for repeat in range(args.repeat):
            run_id = f"{task_id}-{repeat}"
            started = time.monotonic()
            run = bench.execute(task_id, None, run_id, timeout=args.timeout)
            scored = judge_one(bench, task_id, "base", 1, "base", run_id, run)
            row = asdict(scored)
            row["run_dir"] = str(run)
            row["wall_s"] = round(time.monotonic() - started, 3)
            report["runs"].append(row)
            print(f"{'PASS' if scored.all_pass and scored.graded else 'FAIL'} {run_id} {scored.n_passed}/{scored.n_criteria}", flush=True)
    report["passed"] = sum(r["all_pass"] and not r["error"] for r in report["runs"])
    report["total"] = len(report["runs"])
    report["ok"] = report["passed"] == report["total"]
    (bench.root / "report.json").write_text(json.dumps(report, indent=2))
    print(f"{report['passed']}/{report['total']} passed; {bench.root / 'report.json'}")
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
