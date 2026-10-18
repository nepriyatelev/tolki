import type { HostingProblem } from '@shared/network'

export type ErrorKind =
  | { kind: 'cannot-host'; problem: HostingProblem; port: number; localAddress: string | null }
  | { kind: 'host-offline' }
  | { kind: 'too-many-attempts' }
  | { kind: 'host-closed'; roomName: string }
  | { kind: 'connection-lost'; roomName: string }
  /** The organizer removed this participant (#42); coming back by the link is allowed. */
  | { kind: 'removed'; roomName: string }
  | { kind: 'room-full' }
  | { kind: 'update-required'; reason: 'newer-link' | 'host-version' }

export interface Tip {
  title: string
  text: string
}

export interface ErrorContent {
  tone: 'danger' | 'neutral'
  title: string
  text: string
  tips: Tip[]
}

const ANOTHER_ORGANIZER: Tip = {
  title: 'Выбрать другого организатора',
  text: 'Комнату может открыть любой участник, у которого внизу главного экрана написано «Этот компьютер может быть организатором».',
}
const IPV6: Tip = {
  title: 'Включить IPv6',
  text: 'Если провайдер даёт IPv6, его можно включить в настройках роутера — участники с IPv6 подключатся без проброса порта.',
}
const TAILSCALE: Tip = {
  title: 'Tailscale',
  text: 'Если Tailscale установлен у всех участников, в ссылке можно заменить адрес после «h=» на адрес Tailscale этого компьютера (100.x.y.z) — порт пробрасывать не нужно.',
}

function manualForwarding(port: number, localAddress: string | null): Tip {
  const target = localAddress ?? 'адрес этого компьютера'
  return {
    title: 'Пробросить порт вручную',
    text: `В настройках роутера (обычно http://192.168.1.1 или http://192.168.0.1), раздел «Проброс портов» / «Port forwarding»: порт ${port} для TCP и UDP на ${target}.`,
  }
}

function cannotHostTips(problem: HostingProblem, port: number, localAddress: string | null): Tip[] {
  switch (problem) {
    // Owner's decision (#60): for a VPN only these two tips.
    case 'vpn':
      return [
        {
          title: 'Выключить VPN',
          text: 'На время созвона — через VPN участники не подключатся.',
        },
        {
          title: 'Или добавить Tolki в исключения VPN',
          text: 'В настройках VPN-клиента это обычно называется split tunneling или «раздельное туннелирование».',
        },
      ]
    case 'cgnat':
      return [
        {
          title: 'Подключить белый IP у провайдера',
          text: 'Провайдер выдаёт один адрес на многих клиентов (CGNAT) — проброс порта не поможет. Белый IP обычно подключают за небольшую плату.',
        },
        IPV6,
        ANOTHER_ORGANIZER,
        TAILSCALE,
      ]
    case 'double-nat':
      return [
        {
          title: 'Убрать второй роутер',
          text: 'Роутер подключён через модем провайдера, который тоже раздаёт адреса. Поможет режим моста (bridge) на модеме или проброс порта на обоих устройствах.',
        },
        IPV6,
        ANOTHER_ORGANIZER,
        TAILSCALE,
      ]
    case 'no-gateway':
      return [
        {
          title: 'Проверить подключение',
          text: 'Роутер не найден. Если включён VPN, его стоит выключить на время созвона.',
        },
        ANOTHER_ORGANIZER,
        TAILSCALE,
      ]
    case 'unsupported':
    case 'refused':
    case 'bad-address':
    case 'mapping-disabled':
      return [manualForwarding(port, localAddress), IPV6, ANOTHER_ORGANIZER, TAILSCALE]
  }
}

const CANNOT_HOST_TEXT: Record<HostingProblem, string> = {
  vpn: 'Включён VPN: ответы участникам уходят через него, и подключиться к этому компьютеру нельзя.',
  cgnat: 'Провайдер выдаёт общий адрес (CGNAT): входящие подключения сюда не дойдут.',
  'double-nat':
    'Роутер подключён через другой роутер (двойной NAT): входящие подключения сюда не дойдут.',
  'no-gateway': 'Не найден роутер, через который участники могли бы подключиться.',
  unsupported:
    'Роутер не открывает порты автоматически (UPnP и NAT-PMP выключены или не поддерживаются).',
  refused: 'Роутер отказался открыть порт автоматически.',
  'bad-address': 'Роутер сообщил непонятный внешний адрес.',
  'mapping-disabled': 'Автоматический проброс порта выключен.',
}

/** Title, explanation and tips for each error screen (PLAN #18). Neutral wording (#88). */
export function errorContent(error: ErrorKind): ErrorContent {
  switch (error.kind) {
    case 'cannot-host':
      return {
        tone: 'danger',
        title: 'Этот компьютер не может быть организатором',
        text: CANNOT_HOST_TEXT[error.problem],
        tips: cannotHostTips(error.problem, error.port, error.localAddress),
      }
    case 'host-offline':
      return {
        tone: 'neutral',
        title: 'Организатор не в сети',
        text: 'Подключиться к комнате не получилось.',
        tips: [
          {
            title: 'Комната открыта?',
            text: 'Ссылка работает, только пока организатор держит комнату открытой.',
          },
          {
            title: 'Организатор сменил сеть?',
            text: 'После перезагрузки роутера или смены сети адрес меняется — нужна новая ссылка.',
          },
          { title: 'Есть ли интернет?', text: 'Стоит проверить подключение этого компьютера.' },
        ],
      }
    case 'too-many-attempts':
      return {
        tone: 'danger',
        title: 'Неверный пароль',
        text: 'Слишком много неверных попыток. Через минуту можно попробовать снова; пароль — у организатора.',
        tips: [],
      }
    case 'host-closed':
      return {
        tone: 'neutral',
        title: 'Организатор закрыл комнату',
        text: `Комната «${error.roomName}» закрыта. Она останется в недавних — войти снова можно, когда организатор её откроет.`,
        tips: [],
      }
    case 'removed':
      return {
        tone: 'neutral',
        title: 'Удаление из комнаты',
        text: `Организатор удалил это подключение из комнаты «${error.roomName}». Войти снова можно по той же ссылке.`,
        tips: [],
      }
    case 'connection-lost':
      return {
        tone: 'danger',
        title: 'Связь с комнатой потеряна',
        text: `Соединение с комнатой «${error.roomName}» прервалось. Стоит проверить интернет и войти снова.`,
        tips: [],
      }
    case 'room-full':
      return {
        tone: 'neutral',
        title: 'Комната заполнена',
        text: 'В комнате уже 15 человек — это максимум. Войти можно, когда кто-нибудь выйдет.',
        tips: [],
      }
    case 'update-required':
      return {
        tone: 'neutral',
        title: 'Нужна новая версия',
        text:
          error.reason === 'newer-link'
            ? 'Ссылка создана в более новой версии Tolki. Последняя версия скачивается за пару минут.'
            : 'У этого приложения и у организатора разные версии Tolki. Нужна последняя версия.',
        tips: [],
      }
  }
}
