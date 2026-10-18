import type { PortMappingMethod } from '@shared/host-protocol'
import type { HostingProblem, NetworkCheckResult } from '@shared/network'

export interface HostingStatusText {
  tone: 'ok' | 'bad'
  title: string
  details: string[]
}

const METHOD_NAMES: Record<PortMappingMethod, string> = {
  pcp: 'PCP',
  'nat-pmp': 'NAT-PMP',
  upnp: 'UPnP',
}

const PROBLEMS: Record<HostingProblem, string> = {
  cgnat: 'провайдер выдаёт общий адрес (CGNAT)',
  'double-nat': 'роутер подключён через другой роутер (двойной NAT)',
  'no-gateway': 'не найден роутер',
  vpn: 'включён VPN — через него участники не подключатся',
  unsupported: 'роутер не открывает порты автоматически',
  refused: 'роутер отказался открыть порт',
  'bad-address': 'роутер сообщил непонятный внешний адрес',
  'mapping-disabled': 'автоматический проброс порта выключен',
}

function advice(problem: HostingProblem, port: number): string {
  switch (problem) {
    case 'cgnat':
      return 'Поможет белый IP у провайдера или другой организатор'
    case 'double-nat':
      return 'Поможет режим моста на модеме провайдера или другой организатор'
    case 'no-gateway':
      return 'Если включён VPN, его стоит выключить на время созвона'
    case 'vpn':
      return 'Выключить VPN на время созвона или добавить Ratatosk в исключения VPN (split tunneling)'
    case 'unsupported':
      return `Поможет UPnP в настройках роутера или проброс порта ${port} вручную`
    case 'refused':
      return `Поможет проброс порта ${port} вручную или другой организатор`
    case 'bad-address':
    case 'mapping-disabled':
      return `Порт ${port} должен быть проброшен на роутере`
  }
}

/** Plain-words summary of a network check for the home screen status line. */
export function describeHosting(result: NetworkCheckResult): HostingStatusText {
  const { verdict, port } = result
  const ipv6 = result.ipv6Address !== null ? ['IPv6 доступен'] : []

  if (verdict.canHost && verdict.via === 'ipv4') {
    const address =
      verdict.externalPort === port
        ? verdict.externalAddress
        : `${verdict.externalAddress}:${verdict.externalPort}`
    return {
      tone: 'ok',
      title: `Этот компьютер может быть организатором: порт открыт через ${METHOD_NAMES[verdict.method]}`,
      details: [`Внешний адрес ${address}`, ...ipv6],
    }
  }
  if (verdict.canHost) {
    return {
      tone: 'ok',
      title: 'Этот компьютер может быть организатором через IPv6',
      details: [`По IPv4 нельзя: ${PROBLEMS[verdict.ipv4Problem]}`],
    }
  }
  return {
    tone: 'bad',
    title: `Этот компьютер не может быть организатором: ${PROBLEMS[verdict.problem]}`,
    details: [advice(verdict.problem, port), ...ipv6],
  }
}
