# CLI reference

> Generated from repository sources. Run `npm run docs:gen`; do not edit by hand.

This reference describes the main branch. The host package version is **0.4.0**.

```text
Usage: compositor [options]

  --cwd DIR               Primary project directory
  --add-dir DIR           Attach another working directory (repeatable)
  --plugins DIR           Additional plugin directory (repeatable)
  --resume [ID]           Resume a session or open interactive history
  --history               Open interactive chat history
  --plain                 Use the line-based interface
  -p, --prompt TEXT       Run a prompt without the TUI (- reads stdin)
  -i, --image FILE        Attach an image (repeatable)
  --model NAME            Select a model
  --max-steps N           Limit agent steps
  --output-format FORMAT  text, json or stream-json
  --output-schema FILE    Validate structured output against a JSON schema
  -v, --version           Print the version
  -h, --help              Print this help
```

See [getting started](../getting-started.md) for complete examples and [the terminal manual](../../packages/app/README.md) for keyboard and mouse controls.
