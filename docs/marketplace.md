# Marketplace и переносимые плагины

Каталог использует `.claude-plugin/marketplace.json`: `name`, `owner`, `plugins`,
относительные `source`, а также GitHub/Git source objects. Формат основан на
[Claude Code marketplace](https://code.claude.com/docs/en/plugin-marketplaces)
и [manifest reference](https://code.claude.com/docs/en/plugins-reference).

```text
/marketplace add owner/repository main
/marketplace list
/extensions install plugin-name@marketplace-name
/reload
```

Локальный каталог: `/marketplace add ./my-marketplace`. Для регистрации из
проектных настроек добавьте `--project`; по умолчанию регистрация пользовательская.
`/marketplace update name` явно обновляет Git snapshot; `remove name` удаляет
регистрацию, сохраняя установленные плагины. Git checkout фиксируется commit SHA.
Поддержаны credential-free HTTPS и локальные директории; ZIP, SSH и private Git
credential flows этой реализацией не добавляются.

Установка по умолчанию пользовательская (`~/.agent-compositor/plugins`).
`/extensions install name@market --project` устанавливает только в
`<cwd>/.agent-compositor/plugins`. Для enable/disable область по умолчанию
проектная; `--user` меняет пользовательскую. Пример с зависимостями:

```text
/extensions install mascot@agent-compositor --dependencies
```

Зависимости ставятся только с явным `--dependencies`, из `package-lock.json`,
через `npm ci --ignore-scripts`. Резервная копия предыдущей версии сохраняется
перед update/remove. Native-плагинам установщик предоставляет host API packages
`@agent-compositor/*`, чтобы imports работали вне исходного monorepo.
После изменений нужен `/reload`. Загрузка disabled-плагинов пропускается до
импорта их исполняемого кода. Установка/изменение каталога проходят существующий
permission gate инструментов `marketplace_control` и `extension_control`.

## Контракты совместимости

| Компонент Claude Code | Поддержка |
| --- | --- |
| `.claude-plugin/plugin.json` | Метаданные, name/version/description |
| `commands/*.md` и явные command paths/maps | `/plugin:command`, `$ARGUMENTS`, `$1`, plugin root |
| `skills/*/SKILL.md` | Явный вызов `/plugin:skill`; description и argument-hint |
| `.mcp.json`, `mcpServers` paths/inline maps | Объединяются с глобальной/проектной MCP-конфигурацией; имена с префиксом плагина |
| `hooks/hooks.json`, explicit hooks paths/inline | Синхронные `type: command`, matcher, stdin JSON, timeout/cancellation |
| PreToolUse | Может deny/ask; allow не отменяет host deny |
| UserPromptSubmit | Может блокировать и добавлять additionalContext |
| SessionStart, PostToolUse/Failure, Stop/Failure, SubagentStart/Stop, Pre/PostCompact | Отображаются на события приложения; завершённый turn не перезапускается решением Stop hook |
| Native TypeScript / Ink UI | Работает в Compositor; для Claude Code требуется отдельный адаптер |

Это явно ограниченная совместимость, не полная реализация Claude Code.
Agents, LSP, monitors/channels, userConfig, HTTP/prompt/agent/async hook handlers,
MCP bundles и неизвестные hook events не поддержаны: loader сообщает ошибку.
`updatedInput` в PreToolUse блокирует действие с объяснением вместо исполнения
с неподдерживаемым преобразованием аргументов. Skill shell interpolation,
автоматический выбор skills моделью и Claude-specific permission/tool mappings
не эмулируются. Для команд/skills сохраняется текст инструкций; поля выбора
модели и allowed-tools в Markdown не меняют host-политику.

Command hooks исполняются как доверенный код пользователя. Permission gate
агента не является OS-песочницей для установленного плагина.

## Поделиться плагином

В этом репозитории есть готовый каталог на 26 записей и
[переносимый пример](../examples/plugins/portable-example/.claude-plugin/plugin.json).
В native entries поле `compositor.format` явно указывает runtime. Общий формат
каталога не делает native TS/UI код исполнимым в другом приложении.

```sh
npm run marketplace:validate
```

Для собственного Git marketplace сохраните `.claude-plugin/marketplace.json`
и директории плагинов в репозитории, проверьте его, затем поделитесь URL.
Публикация в Anthropic marketplace не выполняется автоматически.

```json
{
  "name": "my-marketplace",
  "owner": { "name": "My team" },
  "plugins": [{ "name": "my-plugin", "source": "./plugins/my-plugin" }]
}
```

Для внешнего GitHub-плагина:
`{"name":"my-plugin","source":{"source":"github","repo":"owner/repo","ref":"main","sha":"<40-character-commit>"}}`.
Для Git URL используется `source: "url", url: "https://..."`; поддержан `path`
подкаталога. Пути не могут выходить за root, в том числе через symlinks.
