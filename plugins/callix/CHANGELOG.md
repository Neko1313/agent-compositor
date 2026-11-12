# Changelog

## 1.4.0

<!-- plugin-release:auto:start -->
- require completed checks for coding changes ([fdd3d9b](https://github.com/Neko1313/agent-compositor/commit/fdd3d9be6847a6951ee8e10110924d70e6d4e303))
- clarify discovery and read pagination recovery ([f14d3ce](https://github.com/Neko1313/agent-compositor/commit/f14d3ce41a59b89a4cd80d76714fda110348eb46))
- reject edits that leave file text unchanged ([9cb714b](https://github.com/Neko1313/agent-compositor/commit/9cb714b10a15a8a8ac4d50264b38c33eca620d69))
- recover from repeated finite query results ([a66fcc3](https://github.com/Neko1313/agent-compositor/commit/a66fcc38dc868ff1ef0879fdb0ff8a2992188978))
<!-- plugin-release:auto:end -->

## 1.3.4

<!-- plugin-release:auto:start -->
- canonicalize custom tool paths before policy ([ef0c26b](https://github.com/Neko1313/agent-compositor/commit/ef0c26b6c08d3d316f515f7a761ff6cb43573df8))
<!-- plugin-release:auto:end -->

## 1.3.3

<!-- plugin-release:auto:start -->
- preserve user tasks across harness feedback ([5cd6204](https://github.com/Neko1313/agent-compositor/commit/5cd620464809473925e0f56ce8947708882f39e8))
<!-- plugin-release:auto:end -->

## 1.3.2

<!-- plugin-release:auto:start -->
- keep the current user request in every summary stage ([c23355f](https://github.com/Neko1313/agent-compositor/commit/c23355f9a4fe2be74ebfdc0207a1406fc58cc2c6))
- explain missing guarded edit snapshot hashes ([c31c430](https://github.com/Neko1313/agent-compositor/commit/c31c4307e62ff467b84b07507d5eb40e91ce9434))
<!-- plugin-release:auto:end -->

## 1.3.1

<!-- plugin-release:auto:start -->
- preserve interrupted output and clarify tool recovery ([1af72fb](https://github.com/Neko1313/agent-compositor/commit/1af72fb7b54e7e48cd2b72cfb76870c5e7f0bee8))
- recover oversized tool groups and pack summaries by tokens ([0f5c2c0](https://github.com/Neko1313/agent-compositor/commit/0f5c2c0db8f935eb3fe447a80c682160219dcc2c))
- honor output reserves and profile capacity ceilings ([6d3a267](https://github.com/Neko1313/agent-compositor/commit/6d3a267b10c5328c4fe6b96c82bdf61df5b640d1))
<!-- plugin-release:auto:end -->

## 1.3.0

<!-- plugin-release:auto:start -->
- warm indexes eagerly and keep large graph queries responsive ([275523f](https://github.com/Neko1313/agent-compositor/commit/275523fe7d3421fa4301f90d969e36b4c8fc1784))
- add background completion wakeups and reasoning effort controls ([45dcbc6](https://github.com/Neko1313/agent-compositor/commit/45dcbc6243cfb4ee5b8b76c179eae6816dafc927))
<!-- plugin-release:auto:end -->

Start background warming immediately at session startup/reload, prebuild adjacency
maps, share that build with the first semantic query and drain it on session end.
Keep debounce for subsequent file changes only.

Raise the default full-graph limit from 64 to 256 MiB and distinguish it from
model response budgets in overflow diagnostics. Reuse valid graphs after timeout
or output-limit changes, including older v3 disk caches. Validate disk graphs
without serializing and parsing them a second time.

Add non-indexing readiness/error diagnostics through `code_query` status. Slow
semantic calls return explicit pending results after ten seconds while the
owned background build continues; local text tools remain available. Configure
`queryWaitMs` to change that wait, or `background:false` to retain synchronous
operation. Unload/close cancels and drains retained queries.

Avoid reindexing for prose, logs and unrelated generated files. Bound all
source-change retries by one analysis deadline and allow immediate retry after
cancellation. Keep attached-project disk caches separate, validate actions
before analysis and provide exact model-facing invocation examples. Status
reports missing executables, active builds and the last native error without
mistaking an incomplete graph for a completed navigation result.

## 1.2.0

Adopt Compositor plugin standard 1, declare host API compatibility and a repeatable
plugin-specific test plan. Versions and releases are independent of the host.
