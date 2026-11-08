# Агентные функции: настройка и ограничения

Этот документ описывает реализованный план из MEMORY.md. Расширения остаются
заменяемыми: Monty, Callix, web, auto review и checkpoints подключаются плагинами;
общие service-события и tool.call позволяют заменять обработчики.

## Быстрый доступ

| Возможность | Команда / инструмент |
|---|---|
| Автооценка подтверждений | `/auto on`, `/auto off`, `/auto status` |
| История кода и разговора | `/checkpoints`, `/restore <id> code\|conversation\|both`, `/rewind` |
| Review изменений | `/review [id]`, кнопки Keep change / Revert file |
| Независимые агенты | `/agents`, `/agents create <name>`, `/agents create-shared <name>` |
| Сообщение агенту | `/agents send <id> <prompt>` или клик в окно и ввод |
| Управление агентом | `/agents stop <id>`, `/agents archive <id>`, `/agents merge <id>` |
| Основной разговор | клик по Conversation или `/agents parent` |
| Расширения | `/extensions list\|install\|update\|enable\|disable\|remove [name] [ref]` |
| Вход и ключи | `/auth`, `/login <profile> [ENV_VAR]`, `/logout <profile>` |
| Модели | `/model`, `/model <profile-or-model>` |
| Usage и стоимость | `/usage`, `/cost` |
| Web | `web_fetch`, `web_search` |
| Код | `glob`, `grep`, `code_query` через Callix |
| Изолированный Python | `run_python`, `workflow` через Monty |
| MCP / workflows | `/mcp`, `/workflows` |
| Сессии | `/sessions`, `/resume`, `/fork`, `/rename`, `/archive`, `/unarchive` |

## Auto review

Режим включается явно для текущей сессии. После перезапуска подтверждения снова
ручные. Выключение через кнопку действует и на уже выполняющуюся проверку:
результат устаревшей проверки не подтверждает действие.

В `agent-compositor.json` настройте отдельный профиль малой модели:

```json
{
  "providers": {
    "small": {
      "type": "openai-compat",
      "baseUrl": "http://127.0.0.1:11434/v1",
      "model": "YOUR_SMALL_MODEL",
      "apiKeyEnv": "SMALL_MODEL_API_KEY",
      "maxOutputTokens": 512
    }
  }
}
```

Для той же платформы можно задать `small_model`: приложение создаст профиль
`small` с настройками основного провайдера. `.agent-compositor/auto.json`:

```json
{"profile":"small","maxReviews":50,"timeoutMs":8000}
```

Проверяются только действия, для которых обычная цепочка запросила подтверждение.
Плагин рассматривает точный инструмент, аргументы и descriptor. Он автоматически
подтверждает только явно низкий риск для exec/write/edit; опасные категории,
другие инструменты, слишком большой ввод, исчерпанный бюджет, ошибки, timeout
и невалидный JSON возвращают ручное подтверждение. У review-модели нет инструментов;
данные действия передаются как недоверенное содержимое. Явный deny остаётся
обязательным даже при попытке tool.check его переопределить. Решения не становятся
широкими разрешениями на будущие команды.

Панель показывает причину и риск. Последние 100 решений сохраняются в
`.agent-compositor/approval-audit-<session>.json`. Замена обработчика:
`serviceProviders: {"service.permission.review":"other-reviewer"}`.
Оценка модели помогает выбирать подтверждения; исполнение по-прежнему проходит
через permissions и ограничения выбранного sandbox.

## Checkpoints и review

`checkpoint-history` сохраняет перед обычным ходом код и разговор, затем фиксирует
состояние файлов после завершения, ошибки или остановки. История раздельная для
каждой сессии: `.agent-compositor/turn-checkpoints/<session>/`.

- Code восстанавливает изменённые файлы, включая создание и удаление.
- Conversation восстанавливает только контекст; Code его не меняет.
- Both восстанавливает оба состояния. Возобновление сессии учитывает восстановление.
- Если файл изменился после снимка, восстановление отказывается перезаписывать его.
- `/review` показывает Before/After. Keep оставляет уже внесённое изменение;
  Revert file восстанавливает выбранный файл через обычное подтверждение.

Восстановление выполняется из интерактивных контролов после текущего хода;
модель не может перемотать собственный активный ход. Поле `paths` инструмента
`checkpoint` позволяет выбирать файлы в режиме code. Старый однофайловый
`checkpoints` остаётся совместимым fallback для `/rewind`, когда истории ходов нет.

Снимок охватывает файлы проекта по Git/agent ignore, максимум 10000 файлов,
8 MB на файл и 64 MB исходного содержимого. При превышении снимок не создаётся,
пользователь получает сообщение. Игнорируемые runtime/dependency-файлы, внешние
системы и операции за пределами репозитория не восстанавливаются. UI показывает
последние 100 снимков; review-превью ограничено 10 файлами и 30 строками на сторону.
Старые снимки автоматически не удаляются.

## Независимые агенты и worktrees

У каждого агента отдельный AgentCore, transcript, session ID, permissions state,
лимиты и окно. Родитель может отправлять запросы асинхронно и читать результаты
через `agent_control` с `action=list` и `id`; без id возвращается краткий список.
Обычный `task` остаётся ожидаемым подагентом и возвращает результат родителю.

Create создаёт ветку `agent/<uuid>` и worktree от HEAD в
`.agent-compositor/worktrees/<uuid>`. Create-shared использует текущее дерево:
разговоры разделены, файлы в этом режиме общие. Незакоммиченные изменения основного
дерева не копируются в новый worktree.

Клик по окну выбирает получателя ввода; заголовок Message показывает его имя.
Ctrl+C в выбранном окне останавливает агента. Stop отменяет текущий запрос и очередь.
Подтверждения и вопросы нескольких агентов стоят в очереди; отмена удаляет
ожидающий диалог. После перезапуска окна и разговоры восстанавливаются; незавершённые
действия автоматически не повторяются. Archive сохраняет worktree и файлы.
Merge требует завершённого агента и закоммиченных изменений; Git сообщает конфликты.

По умолчанию доступно 8 активных агентов, до 12 модельных шагов и 50000 токенов
на ход у нового агента, 200000 на его сессию. `agent_control` принимает maxSteps
и maxTokens, `agent.maxAgents` ограничивает количество (не более 16).

## Usage, цены и квоты

`model.usage` учитывает основные запросы, compaction и малую review-модель.
Сохраняются input/output/cache, группировка по модели и счётчики сессии.
Если провайдер не сообщает usage, используется явно помеченная оценка для
бюджетов. Она не выдаётся за точный счёт провайдера и не превращается в стоимость.
Оценка контекста учитывает UTF-8 для не-ASCII текста и вложения.

В `.agent-compositor/pricing.json` задаются ваши тарифы за миллион токенов.
Числа ниже демонстрационные, замените их тарифами своего провайдера:

```json
{"default":{"inputPerMillion":1,"outputPerMillion":2,"cachedInputPerMillion":0.1}}
```

Без тарифа запрос остаётся unpriced, цена не выдумывается. Настройки бюджетов:

```json
{"agent":{"maxTokensPerTurn":50000,"maxTokensPerSession":200000,"maxAgents":8}}
```

Ядро ограничивает запрашиваемый output и останавливает дальнейшее исполнение при
достижении лимита. Это локальные бюджеты по сообщённым/оценённым токенам: уже
сгенерированные провайдером токены могут превысить остаток, особенно input.

У провайдеров нет единого API квот. Для совместимого endpoint задайте в профиле:

```json
{"quota":{"url":"https://api.example.org/quota","remainingPath":"account.remaining","limitPath":"account.limit","resetPath":"account.reset","unit":"tokens"}}
```

Endpoint должен находиться на origin провайдера. Используется ключ профиля,
результат кешируется 30 секунд. Без endpoint или при ошибке UI сообщает, что квота
недоступна. Баланс аккаунта не вычисляется из локального счётчика.

## Расширения

Каталог `.agent-compositor/extensions.json` — массив записей:

```json
[{"name":"my-plugin","repository":"https://example.org/my-plugin.git","ref":"v1.0.0"}]
```

Репозиторий должен содержать plugin.json в корне. Установка идёт в
`$HOME/.agent-compositor/plugins`; обязательна явно выбранная Git ref, результат
содержит фактический commit. Обновление повторяет установку выбранной ref.
Предыдущая версия/удалённое расширение сохраняются в extension-backups.
Исходники ещё не выполняются при install; для активации нужен `/reload`.

Для `extension_control` поле dependencies=true разрешает `npm ci` по lockfile
с выключенными package scripts. Без этого зависимости не устанавливаются.
HTTPS-репозитории не могут содержать credentials в URL; локальные абсолютные
пути подходят для собственной разработки. Git hooks и рекурсивные submodules
при установке выключены. Disabled-плагин не импортируется даже если его код
ломается при импорте. Модули могут экспортировать dispose для освобождения ресурсов
при reload/unload/закрытии; MCP пользуется этим для остановки серверов.

## Вход в провайдеры

`/login <profile> <ENV_VAR>` сохраняет значение переменной окружения. Сам ключ
не вводится в командную строку чата и не попадает в transcript. Credentials хранятся
в `$HOME/.agent-compositor/credentials.json`, права файла 0600. Это защищённый
файл, а не системный keychain. `/logout` удаляет сохранённое значение; отдельно
заданный ключ из окружения/config продолжает действовать.

Для OAuth device flow в профиле задаются oauth.clientId,
deviceAuthorizationEndpoint, tokenEndpoint и необязательный scope. `/login <profile>`
показывает verification URL/code, ожидает подтверждение и сохраняет token/refresh
token. Перед модельным запросом истёкший token обновляется. Нужен ваш
зарегистрированный OAuth-клиент и поддержка grant со стороны сервера; внутренние
схемы входа отдельных vendor CLI не имитируются. HTTPS обязателен, локальный HTTP
разрешается только явно через oauth.allowLocalhost для разработки.

Device flow следует [RFC 8628](https://www.rfc-editor.org/rfc/rfc8628).

## Web и базовые интеграции

`web_fetch` читает HTTP(S) текст/HTML/JSON с deadline 15 секунд и пределом 1 MB;
в модель возвращается до 50000 символов. Redirect требует отдельного fetch и
его разрешения. Web-контент помечен недоверенным.

`web_search` использует BRAVE_SEARCH_API_KEY или SearXNG endpoint из
`.agent-compositor/web.json`: `{"searchUrl":"https://search.example.org/search"}`.
У SearXNG должен быть разрешён JSON format. До 10 результатов, bounded snippets.
Протоколы: [Brave Search](https://api-dashboard.search.brave.com/api-reference/web/search/get),
[SearXNG Search API](https://docs.searxng.org/dev/search_api.html).

См. также [Monty](../plugins/monty/README.md), [Callix](../plugins/callix/README.md),
[Python workflows](../plugins/workflows/README.md) и [UI-темы](ui-theming.md).
Monty изолирует Python и явные host callbacks; отдельные shell tools по-прежнему
исполняются на хосте через обычные permissions.
