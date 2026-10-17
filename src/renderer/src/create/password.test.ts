import { describe, expect, it } from 'vitest'
import { generatePassword, generateRoomId, WORDS } from './password'

describe('generatePassword', () => {
  it('makes two different words and a two-digit number, like «лиса-маяк-42»', () => {
    for (let i = 0; i < 200; i++) {
      const [a, b, n] = generatePassword().split('-')
      expect(WORDS).toContain(a)
      expect(WORDS).toContain(b)
      expect(a).not.toBe(b)
      expect(Number(n)).toBeGreaterThanOrEqual(10)
      expect(Number(n)).toBeLessThanOrEqual(99)
    }
  })

  it('maps random numbers to words deterministically and avoids repeating a word', () => {
    expect(generatePassword(() => Uint32Array.from([0, 1, 32]))).toBe('лиса-маяк-42')
    expect(generatePassword(() => Uint32Array.from([0, 0, 0]))).toBe('лиса-маяк-10')
  })

  it('has 256 distinct words without hyphens or spaces', () => {
    expect(new Set(WORDS).size).toBe(256)
    for (const word of WORDS) expect(word).toMatch(/^[а-яё]+$/)
  })
})

describe('generateRoomId', () => {
  it('makes 10 unambiguous lower-case characters valid for invites', () => {
    const id = generateRoomId()

    expect(id).toMatch(/^[a-km-np-z2-9]{10}$/)
    expect(generateRoomId()).not.toBe(id)
  })
})
