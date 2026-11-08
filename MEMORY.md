# Память проекта

## Реализовано: режим auto для подтверждений

Пользователь попросил добавить в план автоматическое подтверждение действий
по оценке риска небольшой/недорогой моделью. Реализовано как заменяемый плагин поверх общей цепочки разрешений,
с отдельно настраиваемым профилем модели. По умолчанию выключено.

- Режимы: ручной и явно включаемый `auto`.
- Оценивать конкретный инструмент и аргументы: команду, пути, сеть, область
  изменений, обратимость, доступ к секретам и влияние на внешние системы.
- Ответ проверяющей модели — структурированный: уровень риска, решение,
  краткая причина. Низкий риск можно подтверждать в пределах политики;
  опасные, неоднозначные и неизвестные действия передавать пользователю.
- Явный deny и ограничения sandbox остаются обязательными. Ошибка, тайм-аут
  или невалидный ответ проверяющей модели возвращают ручное подтверждение.
- Показывать решения и причины в UI/журнале; предусмотреть пороги, бюджет
  проверок и мгновенное выключение auto. Текст команд и вывод инструментов
  считать данными, не инструкциями для проверяющей модели.

Настройка: `.agent-compositor/auto.json`, команда `/auto on|off|status`.
Полная инструкция по новому функционалу: [docs/agent-features.md](docs/agent-features.md).

## Выбор базовых плагинов

Пользователь выбрал Monty для изолированного исполнения кода, Callix
(https://github.com/Callix-Tools/callix) для анализа и навигации по репозиторию.
Это заменяемые базовые плагины, а не обязательные зависимости ядра.
Для Callix использовать нативный бинарник и JSON-граф (`callix analyze`),
без Python API/venv-прослойки. Плагин `callix` реализует
`service.project.query`; выбор альтернативы — через `serviceProviders`.
Monty изолирует Python-код и явно предоставленные функции хоста; он сам по
себе не обеспечивает OS-изоляцию произвольного shell-процесса.

Ниже сохранён исходный снимок пробелов на дату анализа. Пользователь позже
поручил их реализовать; перед продолжением сверять его с текущим кодом.

### Статус выполнения плана — 2026-11-09

Пользователь явно поручил реализовать все запланированные функции. Код находится
в рабочем дереве, без коммита/публикации. Исходный анализ ниже — исторический
снимок; его список «отсутствует» больше не описывает текущее состояние.

Реализованы:
- Общие модельные и инструментальные контракты, смена моделей и reload tools/hooks.
- Anthropic, Gemini, Responses и OpenAI-compatible; retry, replay metadata,
  изображения, обнаружение оборванного stream до исполнения tool calls.
- Инструкции AGENTS/CLAUDE/GEMINI, skills, @files/@images, ignore, редактор и history.
- Headless text/JSON/JSONL, JSON schema validation, resume/fork/archive/rename UI.
- Permissions once/session/project и auto-review малой моделью с audit и fallback.
- Callix через нативный binary/JSON graph; Monty для Python/workflows, replay/cancel.
- MCP/workflows панели; MCP timeout, cancellation, cwd-aware connection cache,
  освобождение процессов через dispose при reload/закрытии.
- Web fetch и Brave/SearXNG search с ограничениями объёма и отдельными permissions.
- Checkpoints всего доступного проектного дерева и разговора; code/conversation/both,
  защита поздних правок, review Before/After и Keep/Revert выбранного файла.
- Установка/обновление/enable/disable/remove расширений из настроенного Git-каталога;
  lockfile dependencies без scripts, backup предыдущей версии, disable до импорта.
- Ключи в приватном файле, OAuth device flow/refresh для настроенного клиента,
  выбор профиля и logout. Внутренние vendor CLI login-протоколы не имитируются.
- Usage всех модельных вызовов, cache, цены из конфигурации, явно помеченные
  оценки при отсутствии usage, лимиты токенов/шагов и configurable account quota.
- Независимые агенты с отдельными сессиями, окнами, бюджетами и Git worktrees;
  асинхронные сообщения/результаты, stop/queue cancellation, archive/merge,
  выбор адресата мышью и восстановление разговоров/окон после перезапуска.
- Очередь approval/question диалогов нескольких агентов и отмена ожидающего диалога.

Настройка и границы реализации описаны в docs/agent-features.md. Внешние search,
quota и OAuth требуют endpoint/ключей/зарегистрированного клиента пользователя.
Live-проверки реальных облачных аккаунтов без credentials не выполнялись;
проверены HTTP fixtures и локальные процессы. Monty не изолирует host shell;
checkpoints не отменяют внешние side effects и ограничены проектными ignore/size.
UI проверяется реальным PTY/browser сценарием; результаты под dist/visual-verified.

## Агент фичи

Дата: 2026-11-09. Пользователь попросил сохранить результаты сравнения с
Codex CLI, Gemini CLI и Claude Code и вернуться к ним позже. Это список
направлений для обсуждения, а не поручение немедленно реализовать всё.

### Основной вывод

У проекта есть работающий агентный цикл и оконный TUI. Основные пробелы
находятся в инструментах, интеграциях и управлении выполнением.
Перспективное отличие — оконная среда для нескольких независимых агентов
и инструментов. Сейчас несколько conversation-представлений используют
один AgentCore: несколько окон ещё не означают несколько агентов.

### Уже работает

- Потоковые ответы, чтение и изменение файлов, shell и фоновые процессы.
- Остановка и корректировка задачи, очередь запросов.
- Возобновление сессии, сжатие контекста, skills и hooks.
- Todos с UI и сохранением, локальные плагины с UI.
- Оконный TUI: workspaces, фокус мышью, drag/resize, размещение плагинов.

### Отсутствующие возможности

- MCP-клиент: подключение серверов, обнаружение и выполнение инструментов.
- Подагенты: отдельные циклы и контексты, жизненный цикл, обмен результатами,
  бюджеты и изоляция через worktrees. agent.offer/agent.spawn пока декларации.
- OS-песочница для shell/файлов/сети; permissions и guard-плагины её не заменяют.
- Специализированные glob/grep, навигация по символам и LSP. Поиск через shell
  возможен, но отдельного слоя работы с кодом нет.
- Встроенные web_search/web_fetch.
- Изображения, вложения и мультимодальные сообщения провайдерам.
- Полноценный headless-запуск: одноразовый prompt, JSON/JSONL, коды завершения.
- Встроенные diff/review и пользовательский процесс выбора изменений.
- Установка и обновление расширений, каталог, управление зависимостями.

### Частично реализовано

- Провайдеры: OpenAI-compatible Chat Completions; нет нативных Anthropic,
  Gemini, Responses API, входа через аккаунт, выбора модели в UI и полноценного
  восстановления после ошибок провайдера.
- Контекст: память COMPOSITOR.md и загрузчик skills; нет автоматического чтения
  AGENTS.md/CLAUDE.md/GEMINI.md, @files и общей политики исключений контекста.
- Сессии: resume подключён; fork/archive есть в хранилище, но нет UI поиска,
  выбора, именования и ветвления сессий.
- Rewind: последнее сохранённое состояние отдельного файла; нет checkpoint
  всего хода с независимым восстановлением кода и разговора.
- Разрешения: правила и разовое подтверждение; запоминание разрешений на
  сессию/проект не доведено до пользовательского сценария.
- Контекст/usage: приблизительная оценка токенов и сжатие; нет полноценного
  расчёта стоимости, учёта кеша и квот.
- Ввод: slash-подсказки есть; нужны многострочный редактор, история запросов,
  внешний редактор и вложения.
- Сохранение размещения плагинов есть; полного дерева окон с восстановлением
  независимых задач/агентов нет.

### Архитектурные ограничения

- Список доступных модели инструментов фиксируется при создании AgentCore.
  Нужна штатная регистрация инструментов плагинами: схема и обработчик.
- Основной запрос к модели идёт напрямую через provider.complete, поэтому
  переопределение service.model.complete не охватывает весь агентный цикл.
- Проверять актуальное состояние перед реализацией: выводы описывают код
  на дату анализа, а не гарантируют отсутствие будущих изменений.

### Предложенная последовательность (ещё не утверждена)

1. Расширяемое ядро: регистрация инструментов, единая точка обращения к моделям.
2. Работа с репозиторием: инструкции проекта, поиск, @files, редактор ввода, diff.
3. MCP и провайдеры: внешние инструменты, нативные адаптеры, выбор модели.
4. Надёжное выполнение: sandbox, запоминаемые разрешения, checkpoints, headless JSON.
5. Многозадачность: подагенты, независимые сессии, worktrees, отображение в окнах.

### Источники сравнения

- Codex CLI: https://learn.chatgpt.com/docs/codex/cli
- Claude Code extensions: https://code.claude.com/docs/en/features-overview
- Claude checkpoints: https://code.claude.com/docs/en/checkpointing
- Gemini subagents: https://geminicli.com/docs/core/subagents/
- Gemini sandbox: https://geminicli.com/docs/cli/sandbox/
- Gemini headless: https://geminicli.com/docs/cli/headless/
- Gemini extensions: https://geminicli.com/docs/extensions/

Возможности конкурентов различаются; список не утверждает полный паритет
между ними. Перед новым сравнением перепроверять официальные документы.

## Маскот Ghost — заменяемый дефолтный плагин

Пользователь предоставил 10 APNG-анимаций и попросил интерактивный маскот,
реагирующий на hooks компонентов. `plugins/mascot` хранит оригиналы без изменений,
декодирует кадры и подписывается на turn/tool/subagent, ui.reaction и agent.activity.
В ядре нет логики Ghost: общие UiTextView.raster, ui.visibility и $.ui.remove
позволяют заменить плагин. Ink показывает RGBA через цветные полублоки; native
Kitty/Sixel не требуется. Скрытые окна/headless не запускают animation timer.
`/mascot on|off|pause|resume|reload`, кнопки Pause/Resume и Pet Ghost;
конфигурация `.agent-compositor/mascot.json`, сменные project-local APNG packs,
переопределяемые tool/reaction mappings. Подробности plugins/mascot/README.md.

Проверка маскота: 336 tests passed, 1 optional Callix test skipped; typecheck
прошёл. Реальный PTY/browser сценарий — 24 скриншота, report.ok=true
в dist/visual-mascot; проверены смена кадров, клик Pet, пауза, вопрос
подагента, ручное approval и существующие оконные сценарии. Исходные 10 APNG
побайтно совпадают с архивом пользователя.


## Marketplace, home storage, proxy и quality eval — 2026-11-09

По запросу пользователя реализованы в рабочем дереве:
- `.claude-plugin/marketplace.json`, регистрация Git/local marketplaces, explicit
  update/pinned commit, установка name@marketplace в user/project scope, backups.
  Поддержаны relative sources и GitHub/HTTPS Git source objects; собственный каталог
  на 26 записей и переносимый пример commands Markdown. Native host API imports
  работают у установленных вне monorepo плагинов через host package bindings.
- Claude compatibility adapter: namespaced commands/skills, `$ARGUMENTS`/позиционные
  args, MCP maps, синхронные command hooks, matcher/stdin/timeout/cancel,
  deny/ask. Это ограниченный subset: agents/LSP/mods/async/prompt/http hooks и
  userConfig не реализуются молча; unsupported components дают ошибку загрузки.
  Native TS/Ink UI не становится переносимым в Claude автоматически.
- Runtime data по умолчанию в `~/.agent-compositor/projects/<name>-<canonical hash>`:
  sessions, agents/worktrees, Todos, workflows, checkpoints, UI prefs, memory,
  plugin state/cache. Non-destructive one-shot migration старых project-local
  данных. `AGENT_STORAGE_MODE=project` оставляет portable mode.
- `$.storage.config/get/set` + service.storage.*; scopes global/project/session/cache,
  atomically written JSON, plugin namespaces, path/symlink confinement, render guard.
  Legacy relative $.fs .agent-compositor paths remapped. Global/project/component
  configs merge; independent agent roots inherit parent profiles/MCP/proxy while
  keeping separate runtime state and local overrides. `#global note` stores global
  memory; `# note` private project memory. COMPOSITOR.md migrated without deletion.
- Replaceable network-proxy plugin: `/proxy status|on|off`, proxy.json, before-model
  validation, native Node Undici and Bun fetch proxy routing, model streams,
  OAuth/quota/web, shell/MCP proxy environment without global process.env mutation.
  Invalid enabled routing blocks model calls. Actual endpoint remains user-configured,
  disabled by default. API keys OpenAI/Anthropic not supplied or requested now.
- Persistent/background Callix graph, cache fingerprint, source/Git/tool change hooks,
  debounce and cleanup. Queries verify freshness; external edits and restart reuse
  checked through a real CLI subprocess, native Callix adapter also checked.
- Reproducible isolated eval fixtures/rubrics, repetitions/splits/baseline reports,
  explicit live Ollama runs; Gemma4 and DeepSeek model tags preserved exactly.
  DeepSeek cloud tag installed in existing Ollama. No claim of local model inference.
- Real Harness² Substrate + BenchSpec-compatible workspace_config materialisation,
  headless compositor trajectories, process-group timeout. Upstream deterministic
  demo and Compositor/Gemma rollout checked; not a full JobBench/LAB/WorkBuddy result
  or measured recursive model-based optimization gain. Upstream commit
  6868817518876de8fd170c6a8354daca273b6191, Python 3.13 isolated under /tmp.
- Vitest 5/coverage, JUnit/Cobertura and deterministic eval/proxy/catalog CI steps.
  Node >=22.12. Removed vulnerable older Vitest/tinypool toolchain; pre-existing
  Zod 3 major migration is not included. Existing worktree changes preserved;
  no commit/push/publication was requested or performed.

Usage/limits: docs/marketplace.md, docs/state-and-network.md, docs/evals.md.
Current reports: dist/quality-report.json, dist/evals-ollama-final/report.json,
dist/harness2-smoke/report.json, dist/harness2-demo/demo.json,
dist/visual-marketplace-storage/report.json. These are run evidence, not timeless
quality claims. Keep shared catalogs free of machine-local cache paths; Git project
registrations retain pinned provenance and reconstruct cache in the user's home.

Финальная проверка этого этапа: 355 passed + 1 optional Callix skipped (отдельно
нативный Callix 5/5), 45 test files. Coverage lines 80.16%, statements 76.45%,
functions 76.06%, branches 66.02%; gates прошли. Typecheck и diff-check прошли.
Live Ollama 10/10 (по 5 на Gemma и DeepSeek), PTY/browser 26 screenshots, ok=true.
Итоговый машиночитаемый отчёт dist/quality-report.json; выводы/ограничения
в docs/evals.md. Все изменения остаются без commit/push.
