#!/usr/bin/env bash
# Prints Russian release notes for the given tag: download table, first-run hints,
# and the commit subjects since the previous release tag.
set -euo pipefail

tag="$1"
version="${tag#v}"
previous="$(git describe --tags --abbrev=0 --match 'v[0-9]*.[0-9]*.[0-9]*' "${tag}^" 2>/dev/null || true)"

if [ -n "$previous" ]; then
  range="${previous}..${tag}"
  since="с ${previous}"
else
  range="$tag"
  since="в первой версии"
fi

changes="$(git log --no-merges --pretty='- %s' "$range" | grep -vE '^- (chore|ci|test|docs|style)(\(|:)' || true)"
[ -n "$changes" ] || changes="- Внутренние улучшения."

cat <<EOF
## Скачать

| Система | Файл |
|---|---|
| Windows 10/11 (x64) | \`Tolki-${version}-win-x64.exe\` |
| macOS, Apple Silicon (M1 и новее) | \`Tolki-${version}-mac-arm64.dmg\` |
| macOS, Intel | \`Tolki-${version}-mac-x64.dmg\` |
| Linux (x64), любой дистрибутив | \`Tolki-${version}-linux-x86_64.AppImage\` |
| Debian, Ubuntu, Mint (x64) | \`Tolki-${version}-linux-amd64.deb\` |

Приложение не подписано платным сертификатом, поэтому при первом запуске система предупредит:

- **Windows:** «Windows защитила ваш компьютер» → «Подробнее» → «Выполнить в любом случае».
- **macOS:** «Системные настройки» → «Конфиденциальность и безопасность» → «Всё равно открыть».
- **Linux (AppImage):** \`chmod +x Tolki-*.AppImage\`, затем запустить файл.

Проверить, что файл не повреждён: сравните его SHA-256 со строкой в \`SHA256SUMS.txt\`.

## Что нового ${since}

${changes}
EOF
