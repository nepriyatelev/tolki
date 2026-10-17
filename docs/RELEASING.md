# Релизы

## Токен `RELEASES_TOKEN`

### Зачем он нужен

Релизный workflow работает в закрытом репозитории `ratatosk`, а установщики публикует в публичный
`ratatosk-releases`. Встроенный `GITHUB_TOKEN` действует только внутри своего репозитория,
поэтому для записи в `ratatosk-releases` нужен отдельный токен.

Это **fine-grained personal access token** с минимальными правами:

| Параметр          | Значение                                          |
| ----------------- | ------------------------------------------------- |
| Resource owner    | `nepriyatelev`                                    |
| Repository access | Only select repositories → `ratatosk-releases`    |
| Permissions       | Contents: **Read and write** (Metadata: Read-only добавится сам) |

Он хранится в секретах репозитория `ratatosk` под именем `RELEASES_TOKEN` и используется только
на шаге публикации релиза.

### Когда его нужно заменить

- истёк срок действия — дату видно в
  [списке токенов](https://github.com/settings/personal-access-tokens);
- релизный workflow упал на публикации с `401 Bad credentials` или
  `403 Resource not accessible by personal access token`;
- токен мог утечь: попал в чат, лог, скриншот, командную строку, файл в репозитории.

### Как заменить

1. **Отозвать старый токен** (если он ещё существует):
   [Fine-grained tokens](https://github.com/settings/personal-access-tokens) → `ratatosk-releases` →
   **Delete**.
2. **Создать новый**: [Generate new token](https://github.com/settings/personal-access-tokens/new).
   - Token name: `ratatosk-releases`
   - Expiration: на выбор (рекомендуется 1 год — тогда эта инструкция понадобится раз в год)
   - Resource owner: `nepriyatelev`
   - Repository access: **Only select repositories** → `nepriyatelev/ratatosk-releases`
   - Repository permissions → **Contents: Read and write**, больше ничего не включать
   - **Generate token** и скопировать значение (`github_pat_…`) — GitHub покажет его один раз.
3. **Сохранить в секрет** — одним из способов, не вставляя токен в чат, в аргументы команды
   или в файлы:
   - веб: [Settings → Secrets and variables → Actions](https://github.com/nepriyatelev/ratatosk/settings/secrets/actions)
     → `RELEASES_TOKEN` → **Update** (или **New repository secret**, если его нет);
   - в своём терминале (команда сама спросит значение):
     ```bash
     gh secret set RELEASES_TOKEN -R nepriyatelev/ratatosk
     ```
     Имя секрета — первый аргумент. Токен вставляется только в ответ на запрос.
4. **Проверить**, что дата обновления секрета сменилась:
   ```bash
   gh secret list -R nepriyatelev/ratatosk
   ```
5. Если релиз упал из-за токена — **перезапустить** упавшие job'ы:
   ```bash
   gh run list -R nepriyatelev/ratatosk --workflow release.yml --limit 5
   gh run rerun <run-id> --failed -R nepriyatelev/ratatosk
   ```

### Если токен утёк

1. Сразу удалить его (шаг 1 выше) — после этого он бесполезен.
2. Проверить [релизы `ratatosk-releases`](https://github.com/nepriyatelev/ratatosk-releases/releases):
   нет ли чужих релизов или подменённых файлов. Сверить файлы с `SHA256SUMS.txt` из сборки.
3. Создать новый токен и обновить секрет (шаги 2–4).
4. Если токен попал в историю терминала — удалить строку (`grep -n github_pat_ ~/.zsh_history`).

Значение секрета после сохранения не может прочитать никто, включая владельца, — его можно только
заменить.
