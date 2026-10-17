import type { HostingProblem } from '@shared/network'

export type ErrorKind =
  | { kind: 'cannot-host'; problem: HostingProblem; port: number; localAddress: string | null }
  | { kind: 'host-offline' }
  | { kind: 'too-many-attempts' }
  | { kind: 'host-closed'; roomName: string }
  | { kind: 'connection-lost'; roomName: string }
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

const ANOTHER_HOST: Tip = {
  title: 'Пусть хостит другой',
  text: 'Комнату может открыть любой друг, у которого внизу главного экрана написано «Можно хостить».',
}
const IPV6: Tip = {
  title: 'Включи IPv6',
  text: 'Если провайдер даёт IPv6, включи его в настройках роутера — друзья с IPv6 смогут подключиться без проброса порта.',
}
const TAILSCALE: Tip = {
  title: 'Tailscale',
  text: 'Если у всей компании установлен Tailscale, замени в ссылке адрес после «h=» на свой адрес Tailscale (100.x.y.z) — порт пробрасывать не нужно.',
}

function manualForwarding(port: number, localAddress: string | null): Tip {
  const target = localAddress ?? 'адрес этого компьютера'
  return {
    title: 'Пробрось порт вручную',
    text: `Открой настройки роутера (обычно http://192.168.1.1 или http://192.168.0.1), раздел «Проброс портов» / «Port forwarding», и пробрось порт ${port} для TCP и UDP на ${target}.`,
  }
}

function cannotHostTips(problem: HostingProblem, port: number, localAddress: string | null): Tip[] {
  switch (problem) {
    // Owner's decision (#60): for a VPN only these two tips.
    case 'vpn':
      return [
        {
          title: 'Выключи VPN',
          text: 'На время созвона — через VPN друзья не смогут подключиться.',
        },
        {
          title: 'Или добавь Ratatosk в исключения VPN',
          text: 'В настройках VPN-клиента это обычно называется split tunneling или «раздельное туннелирование».',
        },
      ]
    case 'cgnat':
      return [
        {
          title: 'Попроси у провайдера белый IP',
          text: 'Провайдер выдаёт один адрес на многих клиентов (CGNAT) — проброс порта не поможет. Белый IP обычно подключают за небольшую плату.',
        },
        IPV6,
        ANOTHER_HOST,
        TAILSCALE,
      ]
    case 'double-nat':
      return [
        {
          title: 'Убери второй роутер',
          text: 'Твой роутер подключён через модем провайдера, который тоже раздаёт адреса. Включи на модеме режим моста (bridge) или пробрось порт на обоих устройствах.',
        },
        IPV6,
        ANOTHER_HOST,
        TAILSCALE,
      ]
    case 'no-gateway':
      return [
        {
          title: 'Проверь подключение',
          text: 'Приложение не нашло роутер. Если включён VPN — выключи его на время созвона.',
        },
        ANOTHER_HOST,
        TAILSCALE,
      ]
    case 'unsupported':
    case 'refused':
    case 'bad-address':
    case 'mapping-disabled':
      return [manualForwarding(port, localAddress), IPV6, ANOTHER_HOST, TAILSCALE]
  }
}

const CANNOT_HOST_TEXT: Record<HostingProblem, string> = {
  vpn: 'Включён VPN: ответы друзьям уходят через него, и подключиться к тебе нельзя.',
  cgnat: 'Провайдер выдаёт общий адрес (CGNAT): входящие подключения до тебя не дойдут.',
  'double-nat': 'Роутер подключён через другой роутер (двойной NAT): друзья до тебя не достучатся.',
  'no-gateway': 'Не найден роутер, через который друзья могли бы подключиться.',
  unsupported:
    'Роутер не открывает порты автоматически (UPnP и NAT-PMP выключены или не поддерживаются).',
  refused: 'Роутер отказался открыть порт автоматически.',
  'bad-address': 'Роутер сообщил непонятный внешний адрес.',
  'mapping-disabled': 'Автоматический проброс порта выключен.',
}

/** Title, explanation and tips for each error screen (PLAN #18). */
export function errorContent(error: ErrorKind): ErrorContent {
  switch (error.kind) {
    case 'cannot-host':
      return {
        tone: 'danger',
        title: 'Нельзя хостить',
        text: CANNOT_HOST_TEXT[error.problem],
        tips: cannotHostTips(error.problem, error.port, error.localAddress),
      }
    case 'host-offline':
      return {
        tone: 'neutral',
        title: 'Хост не в сети',
        text: 'Не получилось подключиться к комнате.',
        tips: [
          {
            title: 'Комната открыта?',
            text: 'Ссылка работает, только пока у хоста открыта комната. Попроси открыть её снова.',
          },
          {
            title: 'Хост сменил сеть?',
            text: 'После перезагрузки роутера или переезда в другую сеть адрес меняется — попроси новую ссылку.',
          },
          { title: 'Проверь интернет', text: 'Убедись, что у тебя самого есть подключение.' },
        ],
      }
    case 'too-many-attempts':
      return {
        tone: 'danger',
        title: 'Неверный пароль',
        text: 'Слишком много неверных попыток. Подожди минуту и уточни пароль у хоста.',
        tips: [],
      }
    case 'host-closed':
      return {
        tone: 'neutral',
        title: 'Хост закрыл комнату',
        text: `Комната «${error.roomName}» закрыта. Она останется в недавних — зайти снова можно, когда хост её откроет.`,
        tips: [],
      }
    case 'connection-lost':
      return {
        tone: 'danger',
        title: 'Связь с комнатой потеряна',
        text: `Соединение с комнатой «${error.roomName}» прервалось. Проверь интернет и попробуй войти снова.`,
        tips: [],
      }
    case 'room-full':
      return {
        tone: 'neutral',
        title: 'Комната заполнена',
        text: 'В комнате уже 15 человек — это максимум. Попробуй войти, когда кто-нибудь выйдет.',
        tips: [],
      }
    case 'update-required':
      return {
        tone: 'neutral',
        title: 'Обнови приложение',
        text:
          error.reason === 'newer-link'
            ? 'Ссылка создана в более новой версии Ratatosk. Скачай последнюю версию — это займёт пару минут.'
            : 'У тебя и у хоста разные версии Ratatosk. Обновитесь до последней версии.',
        tips: [],
      }
  }
}
