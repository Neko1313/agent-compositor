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

    def __init__(self, launcher=None, *, model="gemma4:31b-cloud", base_url="http://127.0.0.1:11434/v1",
                 plugin_dirs=None, output_root=None, max_steps=16):
        self.launcher, self.model, self.base_url = launcher, model, base_url
        self.plugin_dirs = [ROOT / "plugins"] if plugin_dirs is None else list(plugin_dirs)
        self.output_root = output_root
        self.max_steps = max_steps

    def surface(self):
        return SURFACE

    def materialise(self, tree_dir: Path, spec, ctx: Mapping[str, str]):
        if spec.install_mode not in ("workspace_config", "compositor_root"):
            raise ValueError("Use install_mode=workspace_config with the Compositor substrate")
        tree_dir = tree_dir.resolve()
        source = HT.read_tree(SURFACE, tree_dir)
        HT.validate(SURFACE, source)
        for key in ctx:
            if key.startswith("file:"):
                name = key[5:]
                if not name or Path(name).is_absolute() or ".." in Path(name).parts:
                    raise ValueError("Integration file escapes staging")
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

    def argv(self, prompt: str, workspace: Path, add_dirs=()):
        return [shutil.which("bun") or "bun", str(ROOT / "packages/app/src/bin.ts"),
                "--cwd", str(workspace),
                *[arg for directory in self.plugin_dirs for arg in ("--plugins", str(directory))],
                *[arg for directory in add_dirs for arg in ("--add-dir", str(directory))],
                "--model", self.model, "--max-steps", str(self.max_steps), "-p", prompt,
                "--output-format", "stream-json"]

    def execute(self, task_ref, install, run_ids, timeout):
        if self.launcher:
            return self.launcher(RunRequest(task_ref, tuple(run_ids), timeout), install)
        task = json.loads(Path(task_ref).read_text())
        outputs = []
        for run_id in run_ids:
            if not run_id or run_id in (".", "..") or Path(run_id).name != run_id:
                raise ValueError("Invalid run id")
            run = Path(tempfile.mkdtemp(prefix=f"compositor-{run_id}-", dir=self.output_root))
            workspace = run / "workspace"
            home = run / "home"
            home.mkdir()
            current = substitute(task, {"workspace": str(workspace), "home": str(home)})
            shutil.copytree(install.staging_dir, workspace)
            for root, files in ((workspace, current.get("files", {})), (home, current.get("home_files", {}))):
                for name, text in files.items():
                    file = fixture_path(root, name)
                    file.parent.mkdir(parents=True, exist_ok=True)
                    file.write_text(text, encoding="utf-8")
            for name, target in current.get("symlinks", {}).items():
                link = fixture_path(workspace, name)
                destination = fixture_path(home, target)
                link.parent.mkdir(parents=True, exist_ok=True)
                link.symlink_to(destination)
            # Grading data is never copied into the execution workspace.
            env = isolated_env(home, self.model, self.base_url)
            with (run / "trajectory.jsonl").open("w") as stdout, (run / "stderr.txt").open("w") as stderr:
                try:
                    proc = subprocess.Popen(self.argv(current["prompt"], workspace, current.get("add_dirs", ())), env=env, stdin=subprocess.DEVNULL,
                                            cwd=workspace,
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
                except OSError as error:
                    result = {"run_id":run_id,"error":str(error),"fingerprint":install.fingerprint}
            result["run_root"] = str(run)
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
            if not isinstance(item, dict):
                continue
            if item.get("kind")=="text": rendered.append("[ASSISTANT] "+item.get("delta", ""))
            elif item.get("event")=="tool.call":
                data=item.get("input",{})
                rendered.append("[ACTION] "+data.get("tool", "")+" "+json.dumps(data.get("input",{}))[:args_trunc])
            elif item.get("event")=="tool.result":
                rendered.append("[OBSERVATION] "+json.dumps(item.get("input",{}))[:obs_trunc])
            elif item.get("type")=="result": rendered.append("[FINAL] "+item.get("response", ""))
        return "\n".join(rendered)[:max_chars]

    def preflight(self):
        if not shutil.which("bun"):
            raise RuntimeError("Install Bun, then npm install in the compositor repository")
        if not (ROOT / "node_modules").is_dir():
            raise RuntimeError("Run npm install in the compositor repository")


def fixture_path(root: Path, name: str) -> Path:
    target = root / name
    if not name or Path(name).is_absolute() or not target.resolve().is_relative_to(root.resolve()):
        raise ValueError("Task fixture escapes its root")
    return target


def substitute(value, slots):
    if isinstance(value, str):
        for key, replacement in slots.items():
            value = value.replace("{{" + key + "}}", replacement)
        return value
    if isinstance(value, list):
        return [substitute(item, slots) for item in value]
    if isinstance(value, dict):
        return {substitute(key, slots): substitute(item, slots) for key, item in value.items()}
    return value


def isolated_env(home: Path, model: str, base_url: str) -> dict[str, str]:
    # Do not inherit provider keys, host app settings, proxies or preload hooks.
    env = {key: os.environ[key] for key in ("PATH", "LANG", "LC_ALL", "TERM") if key in os.environ}
    return {**env, "HOME": str(home), "USERPROFILE": str(home), "XDG_CONFIG_HOME": str(home / "config"),
            "AGENT_MODEL": model, "AGENT_BASE_URL": base_url, "AGENT_API_KEY": "harness2-local"}


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
        assert "[ACTION] read" in adapter.read_trajectory(capture,obs_trunc=100,max_chars=1000)
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
