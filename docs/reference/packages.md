# Package map

> Generated from repository sources. Run `npm run docs:gen`; do not edit by hand.

The monorepo contains 19 packages. Public extension contracts live in their exported entry points; internal application modules are implementation details.

| Package | Responsibility |
| --- | --- |
| [`@agent-compositor/agent`](https://github.com/Neko1313/agent-compositor/tree/main/packages/agent) | Historical reference loop and pane demo; not the active product engine. |
| [`@agent-compositor/app`](https://github.com/Neko1313/agent-compositor/tree/main/packages/app) | Assembles the interactive and headless product. |
| [`@agent-compositor/cli`](https://github.com/Neko1313/agent-compositor/tree/main/packages/cli) | Line-based compatibility interface. |
| [`@agent-compositor/config`](https://github.com/Neko1313/agent-compositor/tree/main/packages/config) | Layered configuration, scoped storage and placement settings. |
| [`@agent-compositor/context`](https://github.com/Neko1313/agent-compositor/tree/main/packages/context) | Token budgets and transcript compaction. |
| [`@agent-compositor/core`](https://github.com/Neko1313/agent-compositor/tree/main/packages/core) | Active multi-turn agent engine and replaceable execution strategies. |
| [`@agent-compositor/events`](https://github.com/Neko1313/agent-compositor/tree/main/packages/events) | Versioned event schemas and generated catalog. |
| [`@agent-compositor/hooks`](https://github.com/Neko1313/agent-compositor/tree/main/packages/hooks) | Public plugin API, guarded services and private UI controllers. |
| [`@agent-compositor/loader`](https://github.com/Neko1313/agent-compositor/tree/main/packages/loader) | Manifest validation, module loading and lifecycle. |
| [`@agent-compositor/permissions`](https://github.com/Neko1313/agent-compositor/tree/main/packages/permissions) | Tool policy rules and approval decisions. |
| [`@agent-compositor/plugins`](https://github.com/Neko1313/agent-compositor/tree/main/packages/plugins) | Compatibility facade over the shared loader. |
| [`@agent-compositor/protocol`](https://github.com/Neko1313/agent-compositor/tree/main/packages/protocol) | Versioned JSONL messages and capability negotiation. |
| [`@agent-compositor/provider`](https://github.com/Neko1313/agent-compositor/tree/main/packages/provider) | Model adapters, routing, capabilities and network transport. |
| [`@agent-compositor/renderer-ink`](https://github.com/Neko1313/agent-compositor/tree/main/packages/renderer-ink) | Reference terminal renderer consuming protocol frames. |
| [`@agent-compositor/renderer-opentui`](https://github.com/Neko1313/agent-compositor/tree/main/packages/renderer-opentui) | Experimental OpenTUI frontend for conversations and host-owned plugin windows. |
| [`@agent-compositor/runtime`](https://github.com/Neko1313/agent-compositor/tree/main/packages/runtime) | Onion event dispatcher, ordering, deadlines and fault handling. |
| [`@agent-compositor/session`](https://github.com/Neko1313/agent-compositor/tree/main/packages/session) | Conversation journal, history and replaceable repository routing. |
| [`@agent-compositor/skills`](https://github.com/Neko1313/agent-compositor/tree/main/packages/skills) | Progressive skill discovery and loading. |
| [`@agent-compositor/tools`](https://github.com/Neko1313/agent-compositor/tree/main/packages/tools) | Standard tools, execution and attached-workspace access. |

Read [the architecture guide](../architecture.md), [kernel customization](../core-customization.md), and [UI controller contracts](../ui-controllers.md) before changing composition boundaries.
