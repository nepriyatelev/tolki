# Переименование Ratatosk → Tolki

> Задание для агента в CLI. Прочитать целиком, определить ситуацию в шаге 0 и выполнить только нужные шаги. Всё делать одним PR `chore: rename to Tolki` (кроме переименования репозиториев на GitHub — это делается до PR).
> Пункты с пометкой **[спросить владельца]** без подтверждения не выполнять.
> Этот файл сохранить в репозитории как `docs/RENAME.md`. Иконки и логотипы — из этого же архива (`build/`, `assets/logo/`); они заменяют старые иконки с белкой, в том числе те, что упоминаются в `PLAN.md` как `assets/icon/`.

## Новые имена

| Что | Было | Стало |
|---|---|---|
| Название в интерфейсе | Ratatosk | **Tolki** |
| Репозиторий с кодом (закрытый) | `ratatosk` | `tolki` |
| Репозиторий установщиков (публичный) | `ratatosk-releases` | `tolki-releases` |
| Схема ссылок | `ratatosk://` | `tolki://` |
| npm-пакет / исполняемый файл | `ratatosk` | `tolki` |
| Файлы установщиков | `Ratatosk-…` | `Tolki-${version}-${os}-${arch}.${ext}` |
| Цвет бренда | мятный `#7FD1AE` | синий `#2449C8` (кнопки и акценты в тёмной теме `#3D63F0`, текст на них `#FFFFFF`) |
| Логотип | белка | слово «tolki», шрифт Nunito Black (готовые PNG в `assets/logo/`) |

## Шаг 0. Определить ситуацию

```bash
gh repo view ratatosk --json name,url 2>/dev/null && echo "CODE REPO EXISTS"
gh repo view ratatosk-releases --json name,url 2>/dev/null && echo "RELEASES REPO EXISTS"
gh release list -R {owner}/ratatosk-releases 2>/dev/null | head
```

- **А. Репозиториев ещё нет.** Заменить в `PLAN.md` все `Ratatosk`/`ratatosk` на `Tolki`/`tolki`, положить иконки из этого архива и выполнять `PLAN.md` как обычно. Остальные шаги не нужны.
  ```bash
  sed -i 's/Ratatosk/Tolki/g; s/ratatosk/tolki/g' PLAN.md
  ```
  После замены вручную поправить в `PLAN.md`: строку про происхождение названия (белка) удалить, в разделе 7 заменить мятный акцент на синий (таблица выше), логотип — PNG из `assets/logo/`.
- **Б. Репозитории есть, релизов друзьям ещё не раздавали.** Шаги 1–4 и 6. В шаге 2 можно менять всё, включая `appId`.
- **В. Репозитории есть, и друзья уже ставили сборки.** Все шаги 1–6. В шаге 2 — режим совместимости.

## Шаг 1. Переименовать репозитории на GitHub

```bash
gh repo rename tolki -R {owner}/ratatosk --yes
gh repo rename tolki-releases -R {owner}/ratatosk-releases --yes
gh repo edit {owner}/tolki --description "Tolki — P2P voice & screen sharing for friends"
gh repo edit {owner}/tolki-releases --description "Tolki installers"
git remote set-url origin git@github.com:{owner}/tolki.git   # или https-адрес, как был
git fetch origin
```

- GitHub сам перенаправляет старые адреса (веб, git, API, ссылки на файлы релизов) на новые, **пока не создан новый репозиторий со старым именем**. Никогда не создавать репозитории `ratatosk` и `ratatosk-releases` заново — это сломает перенаправление для уже установленных у друзей версий.
- Issues, метки, milestones, релизы, секреты Actions при переименовании сохраняются.
- Проверить, что токен `RELEASES_TOKEN` по-прежнему имеет доступ (fine-grained токены привязаны к репозиторию по id, но проверить обязательно):
  ```bash
  gh api repos/{owner}/tolki-releases --jq .full_name
  ```
  и пробным запуском workflow релиза (шаг 4).

## Шаг 2. Код

Заменить имя везде, кроме мест совместимости ниже.

- `package.json`: `name: "tolki"`, `productName: "Tolki"`, `description`.
- Конфиг electron-builder: `productName: "Tolki"`, `executableName: "tolki"`, `artifactName: "Tolki-${version}-${os}-${arch}.${ext}"`, `protocols: [{ name: "Tolki", schemes: ["tolki"] }]`, `linux.desktop` (Name, StartupWMClass), `publish` → `tolki-releases`.
- Заголовок окна, `app.setName("Tolki")`, все строки интерфейса, `docs/`, `README.md`, `PLAN.md`, `INSTALL.md`.
- Формат ссылки (`src/shared/invite.ts`): генерировать `tolki://join?...`.
- Регистрация протокола: `app.setAsDefaultProtocolClient("tolki")`.
- Проверка обновлений: адрес API → `repos/{owner}/tolki-releases/releases/latest`.
- Цвета: заменить токены мятного акцента на синие (таблица выше). Контраст текста ≥ 4.5:1 проверить заново.
- Логотип в шапке: `assets/logo/tolki-logo-white.png` (тёмная тема). Шрифт Nunito в бандл не добавлять — логотип картинкой; интерфейс остаётся на Onest.

### Режим совместимости (только ситуация В)

- **`appId` не менять.** Тогда новая версия встанет поверх старой (Windows NSIS обновит установку, на macOS сохранится bundle id и выданные разрешения). Меняется только видимое имя. **[спросить владельца]**, если всё же хочется новый `appId` — тогда это будет отдельное приложение рядом со старым.
- **Папка данных.** Electron берёт `userData` из имени приложения, после переименования путь изменится. При первом запуске: если старой папки `…/Ratatosk` нет в новой `…/Tolki`, скопировать из неё недавние комнаты, настройки и **сертификат хоста** (иначе изменится отпечаток, и сохранённые у друзей ссылки на комнаты станут недействительны). Старую папку не удалять.
- **Старые ссылки.** Ещё 2 релиза регистрировать обе схемы (`tolki` и `ratatosk`), парсер принимает обе, создаёт только `tolki://`. Удаление `ratatosk://` — отдельный issue в Backlog.
- Код миграции и совместимости — единственное место, где допустимо слово `ratatosk`. Пометить комментарием `// legacy: remove after vX.Y`.

### Проверка

```bash
rg -i "ratatosk|рататоск" --glob '!CHANGELOG*' --glob '!docs/RENAME.md'
```
Пусто — или только строки с `// legacy`.

## Шаг 3. Иконки

Из этого архива скопировать папку `build/` в корень проекта с заменой:

| Файл | Для чего |
|---|---|
| `build/icon.png` (1024) | исходник, electron-builder по умолчанию |
| `build/icon.ico` (16–256) | Windows: exe, установщик, ярлык |
| `build/icon.icns` | macOS: уже с отступами по сетке Apple, чтобы иконка в Dock была того же размера, что у других приложений |
| `build/icon-macos-1024.png` | то же для macOS, если понадобится PNG |
| `build/icons/NxN.png` (16–1024) | Linux: AppImage, `.deb`, `.desktop` |

- В конфиге electron-builder явно: `mac.icon: build/icon.icns`, `win.icon: build/icon.ico`, `linux.icon: build/icons`.
- В `BrowserWindow` для Linux: `icon: path.join(..., 'build/icons/512x512.png')` (на Windows/macOS иконка берётся из сборки).
- В размерах 16–48 px на иконке буква «t», от 64 px — слово «tolki». Это сделано специально, не «исправлять».
- Удалить все старые иконки с белкой (`git rm`), включая лежащие вне `build/`.
- Логотипы: `assets/logo/*.png` → в ресурсы renderer.

## Шаг 4. Релизы

1. Workflow `release.yml`: репозиторий публикации `tolki-releases`, имена файлов `Tolki-…`, заголовок релиза `Tolki vX.Y.Z`.
2. Пробный прогон без публикации друзьям: тег `vX.Y.Z-rc.1`, релиз пометить **pre-release**, проверить, что собрались все 5 файлов + `SHA256SUMS.txt`, что иконки правильные на всех ОС и deep link `tolki://` открывает приложение. Затем удалить пробный релиз и тег.
3. **Старые релизы не трогать**: не переименовывать файлы и не переписывать теги. Они остаются как история с именем Ratatosk.
4. Новый релиз — следующая **minor**-версия (например `0.1.x → 0.2.0`), чтобы проверка обновлений у старых версий гарантированно его увидела.
5. Release notes (на русском) обязательно с блоком «Переименование»:
   - приложение теперь называется Tolki, всё сохранено;
   - **Windows:** просто установить поверх, старый ярлык заменится;
   - **macOS:** перетащить Tolki в «Программы», старый Ratatosk.app удалить; если macOS заново спросит доступ к микрофону и записи экрана — разрешить;
   - **Linux:** скачать новый AppImage, старый удалить;
   - старые ссылки-приглашения пока работают.
   (Пункты про «поверх» и «старые ссылки» — только для ситуации В.)
6. README `tolki-releases` и `docs/INSTALL.md`: новое имя, новый логотип вверху, новые названия файлов и предупреждений ОС («Tolki» вместо «Ratatosk»).
7. Если уже сделан electron-updater (issue про автообновление): `publish.repo = tolki-releases`; старые клиенты дойдут по перенаправлению GitHub — проверить на одной реальной старой установке.

## Шаг 5. Для уже установленных версий (только ситуация В)

- Старые клиенты проверяют обновления по `ratatosk-releases` → GitHub перенаправит на `tolki-releases` → увидят новую версию. Проверить запросом:
  ```bash
  curl -sI https://api.github.com/repos/{owner}/ratatosk-releases/releases/latest | head -3
  ```
  Ожидается `301` на новый адрес.
- Сообщить владельцу текст для друзей (2–3 предложения), чтобы отправить в общий чат.

## Шаг 6. GitHub-задачи и описание

```bash
gh issue list -R {owner}/tolki --state all --search "Ratatosk in:title,body" --limit 200
```
- В заголовках и описаниях открытых issues заменить Ratatosk → Tolki, `ratatosk://` → `tolki://`, `ratatosk-releases` → `tolki-releases` (`gh issue edit`). Закрытые не трогать.
- Новый issue в Backlog (только ситуация В): «Убрать поддержку ratatosk:// и миграцию userData» с меткой `later`.
- Обновить `docs/PLAN.md` (раздел 1 — убрать абзац про белку, раздел 7 — цвета, все имена).

## Готово, когда

- [ ] репозитории называются `tolki` и `tolki-releases`, старые адреса перенаправляются
- [ ] `rg -i ratatosk` пуст (кроме `// legacy`)
- [ ] сборки на трёх ОС с новой иконкой, имя в системе — Tolki
- [ ] ссылка `tolki://` открывает приложение (и `ratatosk://` — в ситуации В)
- [ ] новый релиз опубликован, release notes с блоком «Переименование»
- [ ] README релизов и INSTALL.md обновлены
- [ ] владельцу отправлен короткий отчёт и текст для друзей
