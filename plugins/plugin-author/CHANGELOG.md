# Changelog

## 2.0.0

<!-- plugin-release:auto:start -->
- recognize project checks and preserve refusal evidence ([facc8ea](https://github.com/Neko1313/agent-compositor/commit/facc8eada572cab7dbb29c1131ec4627a1f36be4))
- avoid repeated approval prompts for refused calls ([b58c249](https://github.com/Neko1313/agent-compositor/commit/b58c249d51a575b26b54539fcb8fe5bf951add47))
- preserve literal source in model-facing read results ([f1557fb](https://github.com/Neko1313/agent-compositor/commit/f1557fb297569b8290e75b50defea47e80f6a46d))
- isolate Todo state and normalize active status aliases ([3df8a39](https://github.com/Neko1313/agent-compositor/commit/3df8a391a0a353e8c5405dd3142b8bfe87ffad4a))
- preserve class tool contracts during composition ([0e03507](https://github.com/Neko1313/agent-compositor/commit/0e0350728f070983c23a33bd944913fce90743b9))
- **BREAKING:** preserve surrounding source on partial file overwrites ([d6e7857](https://github.com/Neko1313/agent-compositor/commit/d6e7857db32d09ea952a31464e4c18e65d0eaf05))
  whole-file write refuses a nonempty existing excerpt by default. For intentional extraction pass allowPartialOverwrite: true. Existing malformed UTF-8 files cannot be safely replaced by the text writer.
- tile plugin management beside active agents ([e65c6d9](https://github.com/Neko1313/agent-compositor/commit/e65c6d93a025b3158512eec17bd43441846e6a99))
- add native questions and private plugin forms ([c459a8e](https://github.com/Neko1313/agent-compositor/commit/c459a8e4499cf053c144407a2bf563aca1fa9dc1))
- run configured application in OpenTUI windows ([d158c10](https://github.com/Neko1313/agent-compositor/commit/d158c10942245428e3e08667d76dd1c4c315a044))
<!-- plugin-release:auto:end -->

## 1.4.0

<!-- plugin-release:auto:start -->
- add immediate commands and main conversation recovery ([4bc76d6](https://github.com/Neko1313/agent-compositor/commit/4bc76d67b8b609d0d161ea74d7ca1a0769c7d815))
- add user-opened conversations and independent agent editors ([31616b7](https://github.com/Neko1313/agent-compositor/commit/31616b7ba177f2787b3adda370865f195c65e35d))
- add semantic tables and a live expandable agent overview ([3d2bfb7](https://github.com/Neko1313/agent-compositor/commit/3d2bfb7ca489ddd18cc65ad017f644bd1517e231))
- add semantic state tabs for agents and workflows ([4afc96e](https://github.com/Neko1313/agent-compositor/commit/4afc96e5bfdaeb37ba2f91d5aaa5e37e5db10997))
- recover from repeated finite query results ([a66fcc3](https://github.com/Neko1313/agent-compositor/commit/a66fcc38dc868ff1ef0879fdb0ff8a2992188978))
<!-- plugin-release:auto:end -->

## 1.3.2

<!-- plugin-release:auto:start -->
- settle closed panels and page editable views ([365db5b](https://github.com/Neko1313/agent-compositor/commit/365db5b48594d16f7af157d77d4478e66857869d))
<!-- plugin-release:auto:end -->

## 1.3.1

<!-- plugin-release:auto:start -->
- require published transitions on every native archive ([5ce76e5](https://github.com/Neko1313/agent-compositor/commit/5ce76e5c6963be27b873498a37c267bd52c17561))
<!-- plugin-release:auto:end -->

## 1.3.0

<!-- plugin-release:auto:start -->
- manage plugins independently of active agent turns ([3dbe2c1](https://github.com/Neko1313/agent-compositor/commit/3dbe2c1c72c859ddf0b903477044d56455403350))
- reap owned subprocesses on cancellation and unload ([627a9b4](https://github.com/Neko1313/agent-compositor/commit/627a9b4f2b4189f549261067cb09490a8a22e4a6))
- run guarded UI tools alongside agent turns ([2d4bedd](https://github.com/Neko1313/agent-compositor/commit/2d4bedd3f571e60bfc7b04e4346338e82565accf))
- open declared plugin commands while agents work ([bf19d5f](https://github.com/Neko1313/agent-compositor/commit/bf19d5fbc77043cc580ed8e5b06da9e2939ad526))
- honor output reserves and profile capacity ceilings ([6d3a267](https://github.com/Neko1313/agent-compositor/commit/6d3a267b10c5328c4fe6b96c82bdf61df5b640d1))
<!-- plugin-release:auto:end -->

## 1.2.0

<!-- plugin-release:auto:start -->
- warm indexes eagerly and keep large graph queries responsive ([275523f](https://github.com/Neko1313/agent-compositor/commit/275523fe7d3421fa4301f90d969e36b4c8fc1784))
- automate plugin versions and changelog preparation ([cba392a](https://github.com/Neko1313/agent-compositor/commit/cba392ae9a959a07b6f3248f1998e2a32052fa46))
- add background completion wakeups and reasoning effort controls ([45dcbc6](https://github.com/Neko1313/agent-compositor/commit/45dcbc6243cfb4ee5b8b76c179eae6816dafc927))
<!-- plugin-release:auto:end -->

## 1.1.1

Check entry syntax without executing code in Bun, improve complete-file authoring guidance and verify requested behavior.

Add requirement-specific deterministic, lifecycle and extracted-archive checks;
UI and model profiles also declare real terminal/reference evaluation cases.

## 1.1.0

Adopt Compositor plugin standard 1, declare host API compatibility and a repeatable
plugin-specific test plan. Versions and releases are independent of the host.
