import { describe, expect, it } from 'vitest'
import { CHAT_MAX_LENGTH, chatParts, chatTextSchema, isOpenableLink } from './chat'

describe('the mini chat (#45)', () => {
  it('takes text with line breaks, trimmed; not empty, not too long, no control characters', () => {
    expect(chatTextSchema.parse('  привет\nвсем  ')).toBe('привет\nвсем')
    expect(chatTextSchema.safeParse('   ').success).toBe(false)
    expect(chatTextSchema.safeParse('x'.repeat(CHAT_MAX_LENGTH + 1)).success).toBe(false)
    expect(chatTextSchema.safeParse('bell\u0007').success).toBe(false)
  })

  it('opens only http and https links', () => {
    expect(isOpenableLink('https://example.com/a?b=1')).toBe(true)
    expect(isOpenableLink('http://example.com')).toBe(true)
    expect(isOpenableLink('javascript:alert(1)')).toBe(false)
    expect(isOpenableLink('file:///etc/passwd')).toBe(false)
    expect(isOpenableLink('tolki://join?v=1')).toBe(false)
    expect(isOpenableLink('not a url')).toBe(false)
  })

  it('picks links out of the text, leaving the closing punctuation outside', () => {
    expect(chatParts('см. https://example.com/a. и http://x.ru')).toEqual([
      { kind: 'text', text: 'см. ' },
      { kind: 'link', url: 'https://example.com/a' },
      { kind: 'text', text: '. и ' },
      { kind: 'link', url: 'http://x.ru' },
    ])
    expect(chatParts('просто текст')).toEqual([{ kind: 'text', text: 'просто текст' }])
    expect(chatParts('(https://example.com)')).toEqual([
      { kind: 'text', text: '(' },
      { kind: 'link', url: 'https://example.com' },
      { kind: 'text', text: ')' },
    ])
  })
})
