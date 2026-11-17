# Changelog

## 1.7.0

<!-- plugin-release:auto:start -->
- run configured application in OpenTUI windows ([d158c10](https://github.com/Neko1313/agent-compositor/commit/d158c10942245428e3e08667d76dd1c4c315a044))
- support private controllers in OpenTUI windows ([eb18d77](https://github.com/Neko1313/agent-compositor/commit/eb18d7764e9eac63f7a5471c3e68ec46dc857ad2))
- keep closed panel hidden during tool calls ([a5dde93](https://github.com/Neko1313/agent-compositor/commit/a5dde9330d093df54c434e60891780077f6227cb))
- direct failed runs to stage retry ([6a72a53](https://github.com/Neko1313/agent-compositor/commit/6a72a5371ea5b95414fff9f878ca32854eb81150))
- preserve state when retry admission fails ([7a689b4](https://github.com/Neko1313/agent-compositor/commit/7a689b45eac85d0179b4c686ab253b4145cb2f42))
- drain retry admission on shutdown ([28b52f7](https://github.com/Neko1313/agent-compositor/commit/28b52f7f6c474f625bfd856adc3f8172a97e65b7))
- drain new run admission on shutdown ([7d9115e](https://github.com/Neko1313/agent-compositor/commit/7d9115e8218ede8a189edc6c24dca6a68a127912))
- protect cross-process control state ([e7f386a](https://github.com/Neko1313/agent-compositor/commit/e7f386a47626b549ad8b2548990b2cfa8767ecf7))
- preserve live remote run state ([4970b42](https://github.com/Neko1313/agent-compositor/commit/4970b42b9128f3f7f74b595b73311f5d77668761))
- expose ownership and refresh external runs ([8ae72fc](https://github.com/Neko1313/agent-compositor/commit/8ae72fc7a28923be537a99fb2112b2be930afef7))
<!-- plugin-release:auto:end -->

## 1.6.1

<!-- plugin-release:auto:start -->
- settle pending renders when closing views ([dff160d](https://github.com/Neko1313/agent-compositor/commit/dff160de00d8961f0c23bd249e521857d5f20cc2))
- await superseding navigation renders ([703f87d](https://github.com/Neko1313/agent-compositor/commit/703f87ddac6c6acd0a432904741d871932d7e5c9))
<!-- plugin-release:auto:end -->

## 1.6.0

<!-- plugin-release:auto:start -->
- add paginated run and stage table navigation ([cc98705](https://github.com/Neko1313/agent-compositor/commit/cc98705eb10b5e295f2755b251c22068d5eb93b7))
- add semantic state tabs for agents and workflows ([4afc96e](https://github.com/Neko1313/agent-compositor/commit/4afc96e5bfdaeb37ba2f91d5aaa5e37e5db10997))
<!-- plugin-release:auto:end -->

## 1.5.0

<!-- plugin-release:auto:start -->
- prepare plugin versions ([b7c7cfc](https://github.com/Neko1313/agent-compositor/commit/b7c7cfcf665d40a1f842875616e56fe5ea772da7))
- open declared plugin commands while agents work ([bf19d5f](https://github.com/Neko1313/agent-compositor/commit/bf19d5fbc77043cc580ed8e5b06da9e2939ad526))
- honor output reserves and profile capacity ceilings ([6d3a267](https://github.com/Neko1313/agent-compositor/commit/6d3a267b10c5328c4fe6b96c82bdf61df5b640d1))
<!-- plugin-release:auto:end -->

## 1.4.0

<!-- plugin-release:auto:start -->
- warm indexes eagerly and keep large graph queries responsive ([275523f](https://github.com/Neko1313/agent-compositor/commit/275523fe7d3421fa4301f90d969e36b4c8fc1784))
- add background completion wakeups and reasoning effort controls ([45dcbc6](https://github.com/Neko1313/agent-compositor/commit/45dcbc6243cfb4ee5b8b76c179eae6816dafc927))
<!-- plugin-release:auto:end -->

## 1.3.0

Adopt Compositor plugin standard 1, declare host API compatibility and a repeatable
plugin-specific test plan. Versions and releases are independent of the host.
