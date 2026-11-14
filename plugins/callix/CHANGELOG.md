# Changelog

## 2.0.0

<!-- plugin-release:auto:start -->
- preview permission rules without executing calls ([8432088](https://github.com/Neko1313/agent-compositor/commit/8432088529f24e3d0a31fdbe02ab717b730d3cfa))
- preserve literal source in model-facing read results ([f1557fb](https://github.com/Neko1313/agent-compositor/commit/f1557fb297569b8290e75b50defea47e80f6a46d))
- isolate Todo state and normalize active status aliases ([3df8a39](https://github.com/Neko1313/agent-compositor/commit/3df8a391a0a353e8c5405dd3142b8bfe87ffad4a))
- bound default reads and recover nonshrinking summary merges ([4be145d](https://github.com/Neko1313/agent-compositor/commit/4be145d84ead92e10cb247aaf16315a6b483bb63))
- validate arguments before permission review ([0ebd093](https://github.com/Neko1313/agent-compositor/commit/0ebd093022e6ab14e0972ddf4ac8aa1ae781ef8d))
- present readable command streams with raw status receipts ([5c32ae8](https://github.com/Neko1313/agent-compositor/commit/5c32ae8b4e6928d7db58c957486ac9ff396d42b8))
- explain and reject invalid guarded edit ranges ([0feafc3](https://github.com/Neko1313/agent-compositor/commit/0feafc376bf77ea45516f67359c119e14580d21e))
- add portable snapshot references for guarded edits ([8328d46](https://github.com/Neko1313/agent-compositor/commit/8328d464424b3828f8f8d515f3e296921fad247f))
- bind reference targets before hooks and authorization ([7ac62fb](https://github.com/Neko1313/agent-compositor/commit/7ac62fbcd1d4a0ecb8fe856776b0fcb4b0adeb3d))
- identify invalid todo fields without changing state ([97a848a](https://github.com/Neko1313/agent-compositor/commit/97a848ae932d4d53527dff27df72872bf7bea3b6))
- **BREAKING:** bound dense reads with continuation cursors ([6d2901c](https://github.com/Neko1313/agent-compositor/commit/6d2901cdb681802e1251a176689c24ddb00fb1c4))
  read returns at most 16000 UTF-8 content bytes per page. Consumers must follow nextCursor before nextOffset to finish dense line windows and large explicit ranges.
- **BREAKING:** connect dense search matches to guarded reads ([7b63ba5](https://github.com/Neko1313/agent-compositor/commit/7b63ba5b1a8d29c618ed3ed324e834e34e356e22))
  native text search uses a fixed raw UTF-8 source view, skips non-UTF-8 files and ignores inherited ripgrep configuration. Long snippets are match-centered and bounded to 2000 UTF-8 bytes; readArgs supplies the guarded read handoff.
- preserve original requests across preparation and review ([40f9198](https://github.com/Neko1313/agent-compositor/commit/40f9198b40a757507cbff0025d5593a993782cd5))
- check failed edit outcomes and verify real coding tasks ([a8fedd8](https://github.com/Neko1313/agent-compositor/commit/a8fedd80c547f78433ae9bbf5128250c4b8557b6))
- **BREAKING:** require a portable model edit target ([c458dc7](https://github.com/Neko1313/agent-compositor/commit/c458dc73e294befd33d5c71b9eabf64e27369cdf))
  the native editor model declaration now requires target, oldText and newText. Supply a path or an edit-v1 reference in target. Existing native path and editRef inputs remain accepted.
- **BREAKING:** preserve surrounding source on partial file overwrites ([d6e7857](https://github.com/Neko1313/agent-compositor/commit/d6e7857db32d09ea952a31464e4c18e65d0eaf05))
  whole-file write refuses a nonempty existing excerpt by default. For intentional extraction pass allowPartialOverwrite: true. Existing malformed UTF-8 files cannot be safely replaced by the text writer.
- run configured application in OpenTUI windows ([d158c10](https://github.com/Neko1313/agent-compositor/commit/d158c10942245428e3e08667d76dd1c4c315a044))
- support private controllers in OpenTUI windows ([eb18d77](https://github.com/Neko1313/agent-compositor/commit/eb18d7764e9eac63f7a5471c3e68ec46dc857ad2))
<!-- plugin-release:auto:end -->

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
