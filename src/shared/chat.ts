import { z } from 'zod'

// The mini chat (PLAN #45): text and links, for the current session only — the host passes
// messages on and keeps nothing; whoever joins later does not see earlier ones.

export const CHAT_MAX_LENGTH = 1000

// eslint-disable-next-line no-control-regex -- control characters are exactly what we reject
const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f]/

/** A message as sent: not empty, not too long, line breaks and tabs only as control characters. */
export const chatTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(CHAT_MAX_LENGTH)
  .refine((text) => !CONTROL_CHARS.test(text), 'control characters')

/** Opened in the browser only these: no file:, javascript:, tolki: or anything else. */
export function isOpenableLink(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

export type ChatPart = { kind: 'text'; text: string } | { kind: 'link'; url: string }

const LINK = /https?:\/\/[^\s<>"]+/g
/** Punctuation that ends a sentence, not the link: «см. https://x.ru/a.» */
const TRAILING = /[.,;:!?)\]»"']+$/

/** Text with its http(s) links picked out, for showing them as links. */
export function chatParts(text: string): ChatPart[] {
  const parts: ChatPart[] = []
  let last = 0
  for (const match of text.matchAll(LINK)) {
    const start = match.index
    let url = match[0]
    const tail = TRAILING.exec(url)?.[0] ?? ''
    url = url.slice(0, url.length - tail.length)
    if (!isOpenableLink(url)) continue
    if (start > last) parts.push({ kind: 'text', text: text.slice(last, start) })
    parts.push({ kind: 'link', url })
    last = start + url.length
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) })
  return parts
}
