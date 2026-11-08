"""Agent Compositor substrate for the upstream Harness² Substrate protocol.

Install upstream separately. No vendor CLI impersonation or automatic edits to
this repository: materialised harnesses and rollouts use isolated directories.
"""
from __future__ import annotations
import argparse
import json
import os
import signal
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Mapping

try:
    from harness2.core.tree import SurfaceSpec
    from harness2.core import tree as HT, runmark as RM
    from harness2.substrate.base import Install, RunRequest, Substrate
except ImportError as error:
    raise SystemExit("Install Harness² (Python 3.12/3.13): uv pip install -e /path/to/harness2") from error

ROOT = Path(__file__).resolve().parents[2]
SURFACE = SurfaceSpec(
    name="agent-compositor",
    always_on=("AGENTS.md", "guardrails.md", "memory.md", "toolguide.md"),
    always_on_max=12000,
    always_on_cap_reason="Keep always-on instructions bounded for reproducible comparisons",
    skill_dir=".agents/skills", skill_name_rule="overrides_dir",
    trigger_hint="Name the skill in AGENTS.md and read its SKILL.md when relevant.",
    autotrigger_file="AGENTS.md",
    trigger_line="- When {desc}, read .agents/skills/{name}/SKILL.md.\n",
    subagent_requires_mode=False, plugin_dir="plugins", hooks_file="hooks.json",
    hook_events=frozenset({"SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop"}),
    stubs=(("scripts/README.md", "Deterministic helpers; execution still follows host permissions.\n"),),
)

class CompositorSubstrate:
    name = "agent-compositor"

    def __init__(self, launcher=None, *, model="gemma4:31b-cloud", base_url="http://127.0.0.1:11434/v1"):
        self.launcher, self.model, self.base_url = launcher, model, base_url

    def surface(self):
        return SURFACE

    def materialise(self, tree_dir: Path, spec, ctx: Mapping[str, str]):
        if spec.install_mode not in ("workspace_config", "compositor_root"):
            raise ValueError("Use install_mode=workspace_config with the Compositor substrate")
        tree_dir = tree_dir.resolve()
        source = HT.read_tree(SURFACE, tree_dir)
        HT.validate(SURFACE, source)
        staging = Path(tempfile.mkdtemp(prefix="compositor-harness-"))
        (staging / "AGENTS.md").write_text("\n\n".join(source.get(key, "") for key in SURFACE.always_on))
        for name, contents in source.items():
            if name in SURFACE.always_on:
                continue
            target = staging / name
            if not target.resolve().is_relative_to(staging):
                raise ValueError("Harness path escapes staging")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(contents)
            if name.startswith("plugins/") and name.endswith(".ts"):
                plugin = staging / "plugins" / Path(name).stem
                plugin.mkdir(exist_ok=True)
                (plugin / "hooks.ts").write_text(contents)
                (plugin / "plugin.json").write_text(json.dumps({"name": "harness-"+plugin.name,"version":"1.0.0","trust":"trusted"}))
        if (staging / "hooks.json").exists():
            plugin = staging / "plugins" / "harness-hooks"
            (plugin / ".claude-plugin").mkdir(parents=True)
            (plugin / "hooks").mkdir()
            shutil.copy2(staging / "hooks.json", plugin / "hooks" / "hooks.json")
            (plugin / ".claude-plugin" / "plugin.json").write_text('{"name":"harness-hooks","version":"1.0.0"}')
        roles = []
        for role in (staging / "sub_agents").glob("*/AGENT.md") if (staging / "sub_agents").exists() else []:
            roles.append(f"Delegation role {role.parent.name}:\n{role.read_text()}")
        with (staging / "AGENTS.md").open("a") as instructions:
            instructions.write("\n\n" + "\n\n".join(roles))
        for key, value in ctx.items():
            if key.startswith("file:"):
                target=staging/key[5:]
                if not target.resolve().is_relative_to(staging):
                    raise ValueError("Integration file escapes staging")
                target.parent.mkdir(parents=True,exist_ok=True)
                target.write_text(value)
        return Install(staging_dir=staging, fingerprint=RM.fingerprint(tree_dir), extras={"install_mode":"workspace_config",**{k:v for k,v in ctx.items() if not k.startswith("file:")}})

    def argv(self, prompt: str, workspace: Path):
        return [shutil.which("bun") or "bun", str(ROOT / "packages/app/src/bin.ts"),
                "--cwd", str(workspace), "--plugins", str(ROOT / "plugins"),
                "--model", self.model, "--max-steps", "8", "-p", prompt,
                "--output-format", "stream-json"]

    def execute(self, task_ref, install, run_ids, timeout):
        if self.launcher:
            return self.launcher(RunRequest(task_ref, tuple(run_ids), timeout), install)
        task = json.loads(Path(task_ref).read_text())
        outputs = []
        for run_id in run_ids:
            if not run_id or Path(run_id).name != run_id:
                raise ValueError("Invalid run id")
            run = Path(tempfile.mkdtemp(prefix="compositor-rollout-"))
            workspace = run / "workspace"
            shutil.copytree(install.staging_dir, workspace)
            for name, text in task.get("files", {}).items():
                file = workspace / name
                if not file.resolve().is_relative_to(workspace):
                    raise ValueError("Task fixture escapes workspace")
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text(text)
            # Grading data is never copied into the execution workspace.
            env = {**os.environ, "HOME": str(run / "home"), "XDG_CONFIG_HOME":str(run / "home/config"),
                   "AGENT_MODEL": self.model, "AGENT_BASE_URL":self.base_url}
            with (run / "trajectory.jsonl").open("w") as stdout, (run / "stderr.txt").open("w") as stderr:
                try:
                    proc = subprocess.Popen(self.argv(task["prompt"], workspace), env=env, stdin=subprocess.DEVNULL,
                                            stdout=stdout, stderr=stderr, start_new_session=True)
                    proc.wait(timeout=timeout)
                    result = {"run_id": run_id, "returncode":proc.returncode,"fingerprint":install.fingerprint}
                except subprocess.TimeoutExpired:
                    try:
                        os.killpg(proc.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    proc.wait()
                    result = {"run_id":run_id,"error":"deadline exceeded","fingerprint":install.fingerprint}
            (run / "execution.json").write_text(json.dumps(result))
            outputs.append(run)
        return outputs

    def read_trajectory(self, stream_path, *, obs_trunc, max_chars, args_trunc=400):
        rendered=[]
        for line in Path(stream_path).read_text().splitlines():
            try:
                item=json.loads(line)
            except json.JSONDecodeError:
                continue
            if item.get("kind")=="text": rendered.append("ASSISTANT "+item.get("delta", ""))
            elif item.get("event")=="tool.call":
                data=item.get("input",{})
                rendered.append("ACTION "+data.get("tool", "")+" "+json.dumps(data.get("input",{}))[:args_trunc])
            elif item.get("event")=="tool.result":
                rendered.append("OBSERVATION "+json.dumps(item.get("input",{}))[:obs_trunc])
            elif item.get("type")=="result": rendered.append("FINAL "+item.get("response", ""))
        return "\n".join(rendered)[:max_chars]

    def preflight(self):
        if not shutil.which("bun"):
            raise RuntimeError("Install Bun, then npm install in the compositor repository")
        if not (ROOT / "node_modules").is_dir():
            raise RuntimeError("Run npm install in the compositor repository")


def check():
    from harness2.core.spec import BenchSpec, BenchPrompts, ChannelSpec
    with tempfile.TemporaryDirectory(prefix="compositor-harness-check-") as temp:
        tree=Path(temp)/"source"
        HT.write_tree(SURFACE,{"AGENTS.md":"Test instructions\n","guardrails.md":"Preserve permissions\n","memory.md":"","toolguide.md":"Use tools\n"},tree,stubs=False)
        adapter=CompositorSubstrate()
        assert isinstance(adapter,Substrate)
        adapter.preflight()
        channel=ChannelSpec("opencode","ollama/gemma4:31b-cloud")
        spec=BenchSpec(name="compositor-check",runs_root=Path(temp)/"runs",install_mode="workspace_config",prompts=BenchPrompts(work="read repository evidence"),channels={"proposer":channel,"selector":channel})
        install=adapter.materialise(tree,spec,{})
        assert "Preserve permissions" in (install.staging_dir/"AGENTS.md").read_text()
        capture=Path(temp)/"trace.jsonl"
        capture.write_text(json.dumps({"kind":"catalog","event":"tool.call","input":{"tool":"read","input":{"path":"x"}}})+"\n")
        assert "ACTION read" in adapter.read_trajectory(capture,obs_trunc=100,max_chars=1000)
        shutil.rmtree(install.staging_dir)
    print("Harness² Substrate protocol, source-tree validation, materialisation and trajectory checks passed")

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--check",action="store_true")
    parser.add_argument("--tree",type=Path)
    parser.add_argument("--task",type=Path)
    parser.add_argument("--model",default="gemma4:31b-cloud")
    parser.add_argument("--timeout",type=int,default=120)
    args=parser.parse_args()
    if args.check:check()
    else:
        from types import SimpleNamespace
        if not args.tree or not args.task:parser.error("--tree and --task are required")
        substrate=CompositorSubstrate(model=args.model);substrate.preflight()
        install=substrate.materialise(args.tree,SimpleNamespace(install_mode="compositor_root"),{})
        try:print(json.dumps([str(p) for p in substrate.execute(str(args.task),install,["probe"],args.timeout)]))
        finally:shutil.rmtree(install.staging_dir)
