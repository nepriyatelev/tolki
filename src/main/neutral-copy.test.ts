import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// The owner's rule (#88): UI texts are neutral — «организатор», not «хост»; no «друзья»; no
// «ты»; impersonal phrasing instead of commands. This guards every user-facing string.

const ROOTS = ['src/renderer/src', 'src/shared']

const BANNED: [RegExp, string][] = [
  [/хост/i, '«организатор» вместо «хост»'],
  [/друз/i, 'без «друзей»'],
  [/(^|[^а-яё])(ты|тебя|тебе|тобой|твой|твоя|твоё|твои|твоего|твоей)([^а-яё]|$)/i, 'без «ты»'],
  [
    /(^|[^а-яё])(попробуй|введи|вставь|выбери|проверь|подожди|обнови|скачай|попроси|отправь|включи|выключи|пробрось|убери|добавь|открой|назови|скажи|разреши|подключи|войди|выйди|зайди|перезапусти)([^а-яё]|$)/i,
    'безличные формулировки вместо команд на «ты»',
  ],
  [/привет|созвонимся\?/i, 'без приветствий и разговорных вопросов'],
]

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

/** Russian text a user can see: string literals and JSX text, comments left out. */
function russianTexts(code: string): string[] {
  const withoutComments = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  return [...withoutComments.matchAll(/'[^'\n]*'|`[^`]*`|"[^"\n]*"|>[^<>{}]*</g)]
    .map((m) => m[0])
    .filter((text) => /[а-яё]/i.test(text))
}

describe('neutral UI copy (#88)', () => {
  const files = ROOTS.flatMap((root) => sources(root))

  it.each(BANNED)('%s — %s', (pattern) => {
    const offenders = files.flatMap((file) =>
      russianTexts(readFileSync(file, 'utf8'))
        .filter((text) => pattern.test(text))
        .map((text) => `${relative('.', file)}: ${text.trim()}`),
    )
    expect(offenders).toEqual([])
  })
})
