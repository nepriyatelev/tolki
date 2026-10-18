import { describe, expect, it } from 'vitest'
import type { JoinError } from '@shared/room'
import { describeJoinError } from './join-errors'

describe('describeJoinError', () => {
  it('puts password problems under the password field', () => {
    expect(describeJoinError('WRONG_PASSWORD')).toEqual({
      field: 'password',
      text: 'Неверный пароль',
    })
    expect(describeJoinError('password-required').field).toBe('password')
  })

  it('asks to wait after too many attempts', () => {
    expect(describeJoinError('TOO_MANY_ATTEMPTS')).toEqual({
      text: 'Слишком много неверных попыток. Через минуту можно попробовать снова.',
    })
  })

  it.each<[JoinError, string]>([
    ['ROOM_FULL', 'заполнена'],
    ['VERSION_MISMATCH', 'Нужна последняя версия'],
    ['certificate-mismatch', 'Подключаться не стоит'],
    ['unreachable', 'не в сети'],
    ['timeout', 'не ответил'],
    ['SCREEN_BUSY', 'Можно попробовать ещё раз'],
    ['BAD_REQUEST', 'Можно попробовать ещё раз'],
    ['protocol', 'Можно попробовать ещё раз'],
  ])('explains %s', (error, text) => {
    const result = describeJoinError(error)
    expect(result.field).toBeUndefined()
    expect(result.text).toContain(text)
  })
})
