# Changelog

## 1.3.1

<!-- plugin-release:auto:start -->
- require published transitions on every native archive ([5ce76e5](https://github.com/Neko1313/agent-compositor/commit/5ce76e5c6963be27b873498a37c267bd52c17561))
<!-- plugin-release:auto:end -->

## 1.3.0

<!-- plugin-release:auto:start -->
- prepare plugin versions ([b7c7cfc](https://github.com/Neko1313/agent-compositor/commit/b7c7cfcf665d40a1f842875616e56fe5ea772da7))
- manage plugins independently of active agent turns ([3dbe2c1](https://github.com/Neko1313/agent-compositor/commit/3dbe2c1c72c859ddf0b903477044d56455403350))
- run guarded UI tools alongside agent turns ([2d4bedd](https://github.com/Neko1313/agent-compositor/commit/2d4bedd3f571e60bfc7b04e4346338e82565accf))
- open declared plugin commands while agents work ([bf19d5f](https://github.com/Neko1313/agent-compositor/commit/bf19d5fbc77043cc580ed8e5b06da9e2939ad526))
- keep interactive approvals alive through human input ([f57620a](https://github.com/Neko1313/agent-compositor/commit/f57620a7ee0ab07e9b7a2b296a976026af67427d))
- honor output reserves and profile capacity ceilings ([6d3a267](https://github.com/Neko1313/agent-compositor/commit/6d3a267b10c5328c4fe6b96c82bdf61df5b640d1))
<!-- plugin-release:auto:end -->

## 1.2.0

<!-- plugin-release:auto:start -->
- warm indexes eagerly and keep large graph queries responsive ([275523f](https://github.com/Neko1313/agent-compositor/commit/275523fe7d3421fa4301f90d969e36b4c8fc1784))
- add background completion wakeups and reasoning effort controls ([45dcbc6](https://github.com/Neko1313/agent-compositor/commit/45dcbc6243cfb4ee5b8b76c179eae6816dafc927))
<!-- plugin-release:auto:end -->

## 1.1.1

Validate complete server configuration before launch and retain operation errors in the panel.

Add requirement-specific deterministic, lifecycle and extracted-archive checks;
UI and model profiles also declare real terminal/reference evaluation cases.

## 1.1.0

Adopt Compositor plugin standard 1, declare host API compatibility and a repeatable
plugin-specific test plan. Versions and releases are independent of the host.
