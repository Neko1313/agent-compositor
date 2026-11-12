# Changelog

## 2.0.0

<!-- plugin-release:auto:start -->
- prepare plugin versions ([b7c7cfc](https://github.com/Neko1313/agent-compositor/commit/b7c7cfcf665d40a1f842875616e56fe5ea772da7))
- **BREAKING:** open persistent side-agent conversations ([2f1f5ae](https://github.com/Neko1313/agent-compositor/commit/2f1f5ae63036b8bd9f9ddc4e6d708a074a6191e6))
  /btw now opens or restores an independent agent conversation and requires catalog 0.26 with agent-hub. Use /btw --once \<question\> for the previous isolated notification response.
- keep controls and human dialog input independent ([e7a6bd1](https://github.com/Neko1313/agent-compositor/commit/e7a6bd14e0a6419d3df9c50729d056f3f1aac03f))
<!-- plugin-release:auto:end -->

## 1.2.2

<!-- plugin-release:auto:start -->
- warm indexes eagerly and keep large graph queries responsive ([275523f](https://github.com/Neko1313/agent-compositor/commit/275523fe7d3421fa4301f90d969e36b4c8fc1784))
<!-- plugin-release:auto:end -->

## 1.2.1

Allow bounded provider completion beyond the default hook deadline, propagate cancellation and await notifications.

Add requirement-specific deterministic, lifecycle and extracted-archive checks;
UI and model profiles also declare real terminal/reference evaluation cases.

## 1.2.0

- Only consume the exact /btw command or its whitespace-separated arguments; leave similarly prefixed commands for their owners.

## 1.1.0

Adopt Compositor plugin standard 1, declare host API compatibility and a repeatable
plugin-specific test plan. Versions and releases are independent of the host.
