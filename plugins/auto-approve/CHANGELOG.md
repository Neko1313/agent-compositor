# Changelog

## 1.5.0

<!-- plugin-release:auto:start -->
- avoid repeated approval prompts for refused calls ([b58c249](https://github.com/Neko1313/agent-compositor/commit/b58c249d51a575b26b54539fcb8fe5bf951add47))
- run configured application in OpenTUI windows ([d158c10](https://github.com/Neko1313/agent-compositor/commit/d158c10942245428e3e08667d76dd1c4c315a044))
- require task context for legacy grants ([654a2ad](https://github.com/Neko1313/agent-compositor/commit/654a2ad44785dbdee2c0eb72c1669b642f18ab28))
- serialize parallel review accounting ([876e2d1](https://github.com/Neko1313/agent-compositor/commit/876e2d1d87b5dd12a4f15e06473eadde032ae978))
- respect workflow review requirements ([cfc7e3e](https://github.com/Neko1313/agent-compositor/commit/cfc7e3ecac1f714d34e9e6d35cbd054c3d62864f))
- handle cancellation during reviewer startup ([182dc52](https://github.com/Neko1313/agent-compositor/commit/182dc528818cd2b9a46e062f667a28116026f80a))
- cancel reviews when mode changes ([e7a416d](https://github.com/Neko1313/agent-compositor/commit/e7a416d8e64d3430d6d0aa501817527562bacab5))
<!-- plugin-release:auto:end -->

## 1.4.1

<!-- plugin-release:auto:start -->
- distinguish uncertainty from concrete refusal ([710e54f](https://github.com/Neko1313/agent-compositor/commit/710e54fbbe8516d71979d65a259e59fb0e1d9277))
<!-- plugin-release:auto:end -->

## 1.4.0

<!-- plugin-release:auto:start -->
- prepare plugin versions ([b7c7cfc](https://github.com/Neko1313/agent-compositor/commit/b7c7cfcf665d40a1f842875616e56fe5ea772da7))
- use active model without reviewer configuration ([da34f54](https://github.com/Neko1313/agent-compositor/commit/da34f548e82e064fb8f34e26fea61ab6ef5b6fe1))
- add immediate commands and main conversation recovery ([4bc76d6](https://github.com/Neko1313/agent-compositor/commit/4bc76d67b8b609d0d161ea74d7ca1a0769c7d815))
- honor task-context approvals and refusals ([76ce8c6](https://github.com/Neko1313/agent-compositor/commit/76ce8c6d91bad6145ca629bbd9afb43e068b100b))
<!-- plugin-release:auto:end -->

## 1.3.1

<!-- plugin-release:auto:start -->
- warm indexes eagerly and keep large graph queries responsive ([275523f](https://github.com/Neko1313/agent-compositor/commit/275523fe7d3421fa4301f90d969e36b4c8fc1784))
<!-- plugin-release:auto:end -->

## 1.3.0

Adopt Compositor plugin standard 1, declare host API compatibility and a repeatable
plugin-specific test plan. Versions and releases are independent of the host.
