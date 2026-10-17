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
      text: 'Слишком много неверных попыток. Подожди минуту и попробуй снова.',
    })
  })

  it.each<[JoinError, string]>([
    ['ROOM_FULL', 'заполнена'],
    ['VERSION_MISMATCH', 'Обнови приложение'],
    ['certificate-mismatch', 'Не подключайся'],
    ['unreachable', 'не в сети'],
    ['timeout', 'не ответил'],
    ['SCREEN_BUSY', 'Попробуй ещё раз'],
    ['BAD_REQUEST', 'Попробуй ещё раз'],
    ['protocol', 'Попробуй ещё раз'],
  ])('explains %s', (error, text) => {
    const result = describeJoinError(error)
    expect(result.field).toBeUndefined()
    expect(result.text).toContain(text)
  })
})
