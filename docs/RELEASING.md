# Релизы

## Как выпустить релиз

1. Убедиться, что `main` зелёный и в нём всё, что должно войти в релиз.
2. Поставить тег и отправить его:
   ```bash
   git switch main && git pull
   git tag v0.1.0
   git push origin v0.1.0
   ```
   Версию берём из тега: `package.json` не меняется (в нём `0.0.0` для dev-сборок).
3. Workflow [Release](https://github.com/nepriyatelev/tolki/actions/workflows/release.yml):
   - собирает установщики на четырёх раннерах (Windows x64, macOS arm64, macOS x64, Linux x64);
   - на каждой ОС запускает e2e-набор на собранном приложении;
   - публикует релиз в [tolki-releases](https://github.com/nepriyatelev/tolki-releases/releases):
     5 установщиков, `SHA256SUMS.txt` и release notes на русском.
   - обновляет README `tolki-releases` из [`docs/INSTALL.md`](INSTALL.md) — инструкцию по
     установке; правки инструкции попадают туда со следующим релизом.
4. Release notes собираются скриптом `.github/release-notes.sh`: таблица файлов, подсказки
   по первому запуску и список коммитов с прошлого тега (без `chore`, `ci`, `test`, `docs`,
   `style`). Текст можно поправить после публикации на странице релиза.
5. Пройти ручную проверку на трёх ОС по [`MANUAL-TEST.md`](MANUAL-TEST.md) на опубликованных
   установщиках; результаты — комментарием в issue релиза. Найденное чинится в PR и выходит
   следующей версией (`v0.1.1`).

Следить за прогоном: `gh run watch -R nepriyatelev/tolki`.

### Если релиз не получился

- Упала сборка или тест — релиз не создаётся. Исправить в PR, удалить тег и поставить заново:
  ```bash
  git push origin :refs/tags/v0.1.0 && git tag -d v0.1.0
  ```
- Упала только публикация (например, токен) — исправить причину и перезапустить
  упавший job: `gh run rerun <run-id> --failed`.
- Удалить ошибочный релиз:
  `gh release delete v0.1.0 -R nepriyatelev/tolki-releases --cleanup-tag`.

### Минуты GitHub Actions

Репозиторий закрытый: macOS-минуты считаются с множителем ×10, Windows — ×2, время каждого
job'а округляется вверх до минуты. Релиз `v0.0.1` занял около 60 минут из бесплатного месячного
лимита (две macOS-сборки — 5 мин × 10, Windows — 3 мин × 2, Linux и публикация — 4 мин),
поэтому сборка запускается только по тегу.

## Токен `RELEASES_TOKEN`

### Зачем он нужен

Релизный workflow работает в закрытом репозитории `tolki`, а установщики публикует в публичный
`tolki-releases`. Встроенный `GITHUB_TOKEN` действует только внутри своего репозитория,
поэтому для записи в `tolki-releases` нужен отдельный токен.

Это **fine-grained personal access token** с минимальными правами:

| Параметр          | Значение                                          |
| ----------------- | ------------------------------------------------- |
| Resource owner    | `nepriyatelev`                                    |
| Repository access | Only select repositories → `tolki-releases`    |
| Permissions       | Contents: **Read and write** (Metadata: Read-only добавится сам) |

Он хранится в секретах репозитория `tolki` под именем `RELEASES_TOKEN` и используется только
на шаге публикации релиза.

### Когда его нужно заменить

- истёк срок действия — дату видно в
  [списке токенов](https://github.com/settings/personal-access-tokens);
- релизный workflow упал на публикации с `401 Bad credentials` или
  `403 Resource not accessible by personal access token`;
- токен мог утечь: попал в чат, лог, скриншот, командную строку, файл в репозитории.

### Как заменить

1. **Отозвать старый токен** (если он ещё существует):
   [Fine-grained tokens](https://github.com/settings/personal-access-tokens) → `tolki-releases` →
   **Delete**.
2. **Создать новый**: [Generate new token](https://github.com/settings/personal-access-tokens/new).
   - Token name: `tolki-releases`
   - Expiration: на выбор (рекомендуется 1 год — тогда эта инструкция понадобится раз в год)
   - Resource owner: `nepriyatelev`
   - Repository access: **Only select repositories** → `nepriyatelev/tolki-releases`
   - Repository permissions → **Contents: Read and write**, больше ничего не включать
   - **Generate token** и скопировать значение (`github_pat_…`) — GitHub покажет его один раз.
3. **Сохранить в секрет** — одним из способов, не вставляя токен в чат, в аргументы команды
   или в файлы:
   - веб: [Settings → Secrets and variables → Actions](https://github.com/nepriyatelev/tolki/settings/secrets/actions)
     → `RELEASES_TOKEN` → **Update** (или **New repository secret**, если его нет);
   - в своём терминале (команда сама спросит значение):
     ```bash
     gh secret set RELEASES_TOKEN -R nepriyatelev/tolki
     ```
     Имя секрета — первый аргумент. Токен вставляется только в ответ на запрос.
4. **Проверить**, что дата обновления секрета сменилась:
   ```bash
   gh secret list -R nepriyatelev/tolki
   ```
5. Если релиз упал из-за токена — **перезапустить** упавшие job'ы:
   ```bash
   gh run list -R nepriyatelev/tolki --workflow release.yml --limit 5
   gh run rerun <run-id> --failed -R nepriyatelev/tolki
   ```

### Если токен утёк

1. Сразу удалить его (шаг 1 выше) — после этого он бесполезен.
2. Проверить [релизы `tolki-releases`](https://github.com/nepriyatelev/tolki-releases/releases):
   нет ли чужих релизов или подменённых файлов. Сверить файлы с `SHA256SUMS.txt` из сборки.
3. Создать новый токен и обновить секрет (шаги 2–4).
4. Если токен попал в историю терминала — удалить строку (`grep -n github_pat_ ~/.zsh_history`).

Значение секрета после сохранения не может прочитать никто, включая владельца, — его можно только
заменить.
