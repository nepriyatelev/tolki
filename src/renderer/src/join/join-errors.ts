import type { JoinError } from '@shared/room'

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
      return { field: 'password', text: 'В комнате есть пароль — спроси его у хоста' }
    case 'TOO_MANY_ATTEMPTS':
      return { text: 'Слишком много неверных попыток. Подожди минуту и попробуй снова.' }
    case 'ROOM_FULL':
      return { text: 'Комната заполнена: в ней уже 15 человек.' }
    case 'VERSION_MISMATCH':
      return { text: 'У тебя и у хоста разные версии Ratatosk. Обнови приложение.' }
    case 'certificate-mismatch':
      return {
        text: 'Сертификат хоста не совпадает со ссылкой. Не подключайся — попроси у хоста новую ссылку.',
      }
    case 'unreachable':
      return { text: 'Хост не в сети или недоступен.' }
    case 'timeout':
      return { text: 'Хост не ответил. Попробуй ещё раз.' }
    case 'SCREEN_BUSY':
    case 'BAD_REQUEST':
    case 'protocol':
      return { text: 'Не получилось подключиться. Попробуй ещё раз.' }
  }
}
