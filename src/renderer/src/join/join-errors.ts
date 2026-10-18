import type { JoinError } from '@shared/room'
import type { ErrorKind } from '../errors/error-content'

export interface JoinErrorText {
  /** Shown under the password field instead of as a general message. */
  field?: 'password'
  text: string
}

/** Plain-words explanation of why joining failed (PLAN #13, #18). */
export function describeJoinError(error: JoinError): JoinErrorText {
  switch (error) {
    case 'WRONG_PASSWORD':
      return { field: 'password', text: 'Неверный пароль' }
    case 'password-required':
      return { field: 'password', text: 'В комнате есть пароль — он у организатора' }
    case 'TOO_MANY_ATTEMPTS':
      return { text: 'Слишком много неверных попыток. Через минуту можно попробовать снова.' }
    case 'ROOM_FULL':
      return { text: 'Комната заполнена: в ней уже 15 человек.' }
    case 'VERSION_MISMATCH':
      return {
        text: 'У этого приложения и у организатора разные версии Tolki. Нужна последняя версия.',
      }
    case 'certificate-mismatch':
      return {
        text: 'Сертификат организатора не совпадает со ссылкой. Подключаться не стоит — нужна новая ссылка от организатора.',
      }
    case 'unreachable':
      return { text: 'Организатор не в сети или недоступен.' }
    case 'timeout':
      return { text: 'Организатор не ответил. Можно попробовать ещё раз.' }
    case 'JOIN_REFUSED':
      return { text: 'Организатор не впустил в комнату.' }
    case 'cancelled':
      // The user stopped waiting themselves: nothing to say.
      return { text: '' }
    case 'SCREEN_BUSY':
    case 'BAD_REQUEST':
    case 'protocol':
      return { text: 'Подключиться не получилось. Можно попробовать ещё раз.' }
  }
}

/**
 * Errors that get a full screen (PLAN #18) instead of a message in the form. A wrong password
 * stays under the field; repeated wrong passwords become the «Неверный пароль» screen.
 */
export function errorScreenFor(error: JoinError): ErrorKind | null {
  switch (error) {
    case 'unreachable':
    case 'timeout':
      return { kind: 'host-offline' }
    case 'TOO_MANY_ATTEMPTS':
      return { kind: 'too-many-attempts' }
    case 'ROOM_FULL':
      return { kind: 'room-full' }
    case 'VERSION_MISMATCH':
      return { kind: 'update-required', reason: 'host-version' }
    default:
      return null
  }
}
