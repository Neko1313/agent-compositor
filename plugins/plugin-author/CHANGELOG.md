# Changelog

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
