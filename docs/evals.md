# Проверки качества и Harness²

## Повторяемые eval

```sh
npm run eval
npm run eval:ollama
npm run eval:proxy
npm run test:ci
npm run marketplace:validate
```

`eval` запускает реальные AgentCore/plugins в изолированных временных проектах
с детерминированным ScriptedProvider. `eval:ollama` прогоняет те же критерии на
Gemma и DeepSeek. Cloud-backed тесты вызываются явно, в обычном CI они не нужны.
Runner ограничивает шаги, токены и deadline; реальные домашние credentials не
копируются. Execution trace и оценки записываются в ignored `dist/evals*/`.

Проверки: чтение evidence инструментом и точный ответ, реальное исправление файла,
сохранение Todos, отказ по permission policy и secret guard до обращения к модели.
Оценка использует artifacts/events и не доверяет фразе модели «сделано».
Это маленький smoke-набор, не оценка универсального качества или ranking моделей.

```sh
npm run eval -- --models gemma4:31b-cloud,deepseek-v4.1-flash:1017-cloud \
  --repeat 3 --output dist/evals-comparison
npm run eval -- --models scripted --split test --output dist/evals-heldout
npm run eval -- --suite tools/evals/cases.json --case read-evidence
npm run eval -- --baseline dist/evals/report.json --output dist/evals-next
```

`--harness path/to/instructions.md` сравнивает вариант системных инструкций;
`--timeout` задаёт deadline в миллисекундах. JSON report содержит rubric checks,
pass rate per model, latency, usage, количество запросов и baseline regressions.
Код возврата ненулевой при неуспешном кейсе. Для новых плагинов добавляйте задачи
с наблюдаемым результатом; обучающие примеры и held-out разделяйте `split`.
Не оптимизируйте harness на тестовых ответах; не передавайте grading в workspace.

CI собирает JUnit и Cobertura, проверяет coverage floors (lines 80%, statements
70%, functions 70%, branches 60%), каталог и детерминированный eval, а также
Bun proxy smoke. Отчёты сохраняются artifact. Набор тестов переведён на Vitest 5,
требуется Node >=22.12; локальные команды совпадают с CI. Cloud credentials в
CI не требуются. Сам GitHub Actions workflow здесь не запускался удалённо.

## Настоящий Harness²

[Harness² upstream](https://github.com/google-research/harness2) разделяет substrate,
benchmark и proposer/selector. `tools/evals/harness2_adapter.py` реализует его
настоящий `Substrate` protocol: surface, materialise, execute, read_trajectory,
preflight. Он не выдаёт приложение за Codex/OpenCode CLI и не меняет этот repo
автоматически по модельным советам.

```sh
git clone https://github.com/google-research/harness2.git /path/to/harness2
uv venv --python 3.13 .venv-harness2
uv pip install --python .venv-harness2/bin/python -e /path/to/harness2
.venv-harness2/bin/python tools/evals/harness2_adapter.py --check
```

Согласованная версия в проверке: upstream commit
`6868817518876de8fd170c6a8354daca273b6191` (также записан в отчёте качества). Python 3.12/3.13; используемый проектом Python 3.14 не подходит upstream.
Временные зависимости устанавливались в /tmp, не в приложение пользователя.

Surface содержит AGENTS.md, guardrails.md, memory.md, toolguide.md, skills,
sub_agents role instructions, scripts и native plugin hooks/Claude command hooks.
Materialisation создаёт отдельный staged workspace; always-on тексты собираются
в AGENTS.md, роли — в инструкции делегирования, plugin TS — в native plugin dirs.
`install_mode` — `workspace_config`, принимаемый настоящим upstream BenchSpec.
CLI также принимает внутренний alias compositor_root. Готовый launcher можно передать constructor;
обычный запуск принимает task JSON с `prompt` и `files`. Оценка хранится вне него.

```sh
.venv-harness2/bin/python tools/evals/harness2_adapter.py \
  --tree path/to/harness-tree --task path/to/task.json \
  --model gemma4:31b-cloud --timeout 120
```

Один rollout запускает реальный `compositor --output-format stream-json`,
ограничивает время процесса и сохраняет trajectory/execution metadata. Завершение
по deadline останавливает группу процессов. Неудалённые rollout dirs нужны для
анализа artifacts; staged harness убирается после CLI запуска.

Выполнены: protocol/materialisation check, upstream deterministic demo в обоих
режимах (2 задачи, 0 ошибок) и сквозной Compositor/Gemma rollout с проверкой
прочитанного token. Это не результаты JobBench/LAB/WorkBuddy и не измерение
улучшения от рекурсивной оптимизации на реальных моделях. Для них требуются
отдельный BenchAdapter, proposer/selector channel, dataset и budgets из upstream.
Адаптер можно подключить к Harness² orchestration через этот protocol seam;
готовые upstream CLI `--substrate cx/oc` сами по себе Compositor не выбирают.

## Текущие результаты

Результаты конкретного запуска сохранены под `dist/evals-ollama-final/report.json`,
`dist/harness2-smoke/report.json`, `dist/harness2-demo/demo.json` и
`dist/visual-marketplace-storage/report.json`. Они не коммитятся как «вечный»
показатель качества. Изменения кода требуют нового прогона затронутого слоя.
