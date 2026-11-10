# 04. Motivation

## The problem

Every new — and every existing — LLM provider reinvents the same CLI agent: authentication, TUI, tool execution, sessions, context compaction, workflows, a plugin system. The predictable result: N half-finished products instead of one good base, and a provider spends quarters on infrastructure instead of their model.

## The other side of the problem

Technologies that work well for some end up locked away by them. Hooks, plugins, workflows, subagents — these mechanics proved themselves in Claude Code, but the world cannot use them natively with its own models.

## The proposal

A base distribution in which a provider needs three steps:

1. **Override login with their own SSO** — an auth plugin; the core is untouched.
2. **Add a plugin for their model** — a name, an endpoint and (optionally) prompt optimizations tuned to their model.
3. **Optionally: workflow presets** — which models to call and how: in effect, adding names and overriding ready-made ones.

Everything else — TUI, tool execution, sessions, plugin runtime, the plugin catalog — already exists and evolves with the community.

## The principle

Don't lock away technologies that work well for some — let the whole world use them natively, with their own models and reuse. Just as Linux doesn't ask who made the user's display, this runtime doesn't ask who made the user's model.

## Who this is for

- **New providers** — their own full-featured CLI agent in days instead of quarters.
- **Existing providers** — a common open standard instead of closed, incompatible forks.
- **Corporations** — SSO, private models, internal plugins.
- **The community** — one written plugin works in every CLI on this runtime.
- **Professional teams** — a domain-specific agent built from selected API,
  workflow and UI capabilities. A team operating infrastructure should be able
  to omit coding tools entirely. Domain integrations belong to extensions;
  the kernel supplies the shared composition and execution contracts.

## License

MIT: frictionless reuse is not a side condition — it is part of the design.
