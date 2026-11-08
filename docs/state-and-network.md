# Хранилище проектов и сеть

## Данные пользователя

Приложение по умолчанию разделяет shared configuration и runtime state:

```text
~/.agent-compositor/
  agent-compositor.json        # глобальные настройки приложения
  mcp.json, proxy.json, ...    # глобальные настройки компонентов
  plugins/                    # пользовательские расширения
  marketplaces.json          # пользовательские каталоги
  credentials.json           # private credentials
  approvals/                 # сохранённые project approvals
  plugin-state/<plugin>/      # память плагинов scope=global
  projects/<directory>-<hash>/
    project.json              # canonical cwd и версия миграции
    sessions/                 # JSONL сессий и metadata
    agents.json, worktrees/   # независимые агенты
    todos.json                # задачи
    workflows/                # код и replay journals
    turn-checkpoints/         # состояние кода/разговора
    layout.json, model.json   # локальные предпочтения
    memory.md                 # private memory текущего проекта
    plugin-state/<plugin>/    # JSON state scope=project
    session-state/<id>/<plugin>/
    cache/<plugin>/           # восстановимые индексы
<project>/.agent-compositor/
  agent-compositor.json      # настройки проекта
  mcp.json, proxy.json, ...   # shared project overrides
  plugins/, skills/          # проектные расширения/инструкции
  marketplaces.json         # проектные регистрации каталогов
```

Идентификатор включает canonical path и hash: одноимённые каталоги не смешивают
сессии; Git worktrees имеют отдельные cwd/state. Независимый агент наследует
app profiles и component settings родителя; его локальные настройки имеют
приоритет, а runtime task/memory state остаётся отдельным. При переносе checkout в другой
путь это новый проект. `AGENT_HOME` задаёт альтернативный пользовательский root;
`AGENT_STORAGE_MODE=project` явно включает прежний portable mode.
XDG global config также поддерживается. Для app config порядок:
пользовательский root → XDG → project walk; для настроек компонентов:
global → project → private local preferences. JSON-объекты merge, массивы заменяются.

При первом старте runtime-файлы старого `<cwd>/.agent-compositor` копируются в
новое хранилище; оригиналы не удаляются. Marker предотвращает повторный импорт
устаревшего состояния. Мигрируются sessions, agents, Todos, layout/model,
checkpoints, workflows и legacy extension metadata. COMPOSITOR.md копируется
в private memory.md. Старые каталоги остаются для ручной проверки/резервной копии.

Глобальные AGENTS.md/CLAUDE.md/GEMINI.md в пользовательском root, файлы в root
проекта и его `.agent-compositor` попадают в инструкции. Skills поддерживают
глобальные и проектные каталоги. `# заметка` сохраняет private project memory;
`#global заметка` — глобальную память memory-плагина. Общие COMPOSITOR.md остаются
в проекте; новые заметки их не переписывают.

## API плагина

```ts
const config = await $.storage.config('my-plugin.json');
await $.storage.set('progress', { completed: 3 }, 'project');
const progress = await $.storage.get('progress', 'project');
await $.storage.set('preferences', { compact: true }, 'global');
await $.storage.set('cursor', { row: 4 }, 'session');
await $.storage.set('symbols', { items: [] }, 'cache');
```

Значения JSON хранятся атомарно, ограничены host write budget и разделены по
имени плагина. `get` возвращает undefined для отсутствующего ключа. Операции
проходят `service.storage.config/read/write`; их можно перехватывать через hooks.
Write запрещён во время `ui.render`. Traversal и symlink escape отклоняются.
`$.storage.paths` сообщает home/state/project. `$.state` остаётся временным
in-memory состоянием; для сохранения между сессиями используйте storage.

Legacy `$.fs.read/write('.agent-compositor/...')` перенаправляет runtime-записи
в private state, с чтением старых/project/global файлов для совместимости.
Произвольный Node fs не переписывается автоматически: ToolContext передаёт
`stateDir`, `settings(name)` и `fetch`; native-плагин должен использовать их.

## Актуальность Callix

Callix сохраняет JSON graph и fingerprint в `cache/callix/index.json`.
Fingerprint проверяется перед чтением graph; пригодный cache переиспользуется
после перезапуска. В активной сессии есть debounce/background refresh по внешним
изменениям source-файлов, Git HEAD/index/refs в рабочем дереве и `project.changed`
после write/edit. `.git`, state, node_modules, build/dist не индексируются как
исходный код. На системах без recursive watch доступны tool hooks и проверка
fingerprint при запросе. Индексация не превращается в непрерывный опрос.

```json
{ "background": true, "debounceMs": 750 }
```

Это настройки callix.json. `background: false` оставляет только refresh on query.
Процесс/таймер/watchers освобождаются при unload/close; ошибки фоновой индексации
попадают в telemetry. При постоянных правках индекс может отставать до завершения
перестроения; запрос проверяет fingerprint, а не считает старый graph актуальным.

## Прокси

Заменяемый дефолтный плагин `network-proxy` читает proxy.json и настраивает общий
клиент через `service.network.configure`. По умолчанию routing выключен.
Конфигурация проверяется перед модельными запросами и сетевыми инструментами;
ошибка не должна незаметно переводить включённый proxy на direct.

```json
{
  "enabled": false,
  "url": "http://127.0.0.1:7890",
  "noProxy": ["localhost", "127.0.0.1", "::1"],
  "models": true,
  "tools": true
}
```

Укажите свой endpoint, затем `/proxy on`; `/proxy status` и `/proxy off` показывают
и меняют режим. Пароль в URL скрывается в status. Локальные предпочтения хранятся
в private state; endpoint не включается автоматически по примеру.

Node использует Undici ProxyAgent/CONNECT, Bun — native fetch proxy. Нативные
OpenAI/Anthropic/Gemini/OpenAI-compatible протоколы и streaming сохраняются.
Тем же маршрутом идут provider OAuth/refresh/quota, web tools, а shell/MCP
получают HTTP_PROXY/HTTPS_PROXY/ALL_PROXY/NO_PROXY для клиентов, которые их
поддерживают. Global process.env не меняется. Явный env MCP-сервера/команды может
переопределить значения; произвольный HTTP-код стороннего плагина не перехватывается
магически — используйте ToolContext.fetch или соответствующие настройки клиента.
Socks и OpenAI-to-Anthropic protocol translation не добавляются.

Ollama остаётся доступен по `http://127.0.0.1:11434/v1`. В этой среде проверены
`gemma4:31b-cloud` и `deepseek-v4.1-flash:1017-cloud`: API обслуживает локальный
Ollama, исполнение этих моделей cloud. OpenAI/Anthropic можно настроить позже
через существующие provider profiles и credentials, сохранив этот transport.
