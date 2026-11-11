# Changelog

## 1.2.2

<!-- plugin-release:auto:start -->
- explain missing guarded edit snapshot hashes ([c31c430](https://github.com/Neko1313/agent-compositor/commit/c31c4307e62ff467b84b07507d5eb40e91ce9434))
<!-- plugin-release:auto:end -->

## 1.2.1

<!-- plugin-release:auto:start -->
- preserve interrupted output and clarify tool recovery ([1af72fb](https://github.com/Neko1313/agent-compositor/commit/1af72fb7b54e7e48cd2b72cfb76870c5e7f0bee8))
<!-- plugin-release:auto:end -->

## 1.2.0

<!-- plugin-release:auto:start -->
- warm indexes eagerly and keep large graph queries responsive ([275523f](https://github.com/Neko1313/agent-compositor/commit/275523fe7d3421fa4301f90d969e36b4c8fc1784))
- add background completion wakeups and reasoning effort controls ([45dcbc6](https://github.com/Neko1313/agent-compositor/commit/45dcbc6243cfb4ee5b8b76c179eae6816dafc927))
<!-- plugin-release:auto:end -->

## 1.1.1

Isolate storage by project and session and prevent cancelled restores from writing files.

Add requirement-specific deterministic, lifecycle and extracted-archive checks;
UI and model profiles also declare real terminal/reference evaluation cases.

## 1.1.0

Adopt Compositor plugin standard 1, declare host API compatibility and a repeatable
plugin-specific test plan. Versions and releases are independent of the host.
