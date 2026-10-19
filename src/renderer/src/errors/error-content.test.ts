import { describe, expect, it } from 'vitest'
import type { HostingProblem } from '@shared/network'
import { errorContent, type ErrorKind } from './error-content'

const cannotHost = (problem: HostingProblem, localAddress: string | null = '192.168.1.42') =>
  errorContent({ kind: 'cannot-host', problem, port: 47000, localAddress })

describe('errorContent', () => {
  it.each<[ErrorKind, string]>([
    [
      { kind: 'cannot-host', problem: 'unsupported', port: 47000, localAddress: null },
      'Этот компьютер не может быть организатором',
    ],
    [{ kind: 'host-offline' }, 'Организатор не в сети'],
    [{ kind: 'too-many-attempts' }, 'Неверный пароль'],
    [{ kind: 'host-closed', roomName: 'Кино' }, 'Организатор закрыл комнату'],
    [{ kind: 'connection-lost', roomName: 'Кино' }, 'Связь с комнатой потеряна'],
    [{ kind: 'room-full' }, 'Комната заполнена'],
    [{ kind: 'update-required', reason: 'newer-link' }, 'Нужна новая версия'],
  ])('%j has the title «%s»', (error, title) => {
    expect(errorContent(error).title).toBe(title)
  })

  it('gives the plan’s tips when the router does not forward the port', () => {
    const titles = cannotHost('unsupported').tips.map((t) => t.title)

    expect(titles).toEqual([
      'Включить UPnP',
      'Пробросить порт вручную',
      'Проверить, нет ли общего адреса провайдера (CGNAT)',
      'Включить IPv6',
      'Выбрать другого организатора',
      'Tailscale',
    ])
    expect(cannotHost('unsupported').tips[1]?.text).toContain(
      'порт 47000 для TCP и UDP на 192.168.1.42',
    )
    expect(cannotHost('unsupported', null).tips[1]?.text).toContain('на адрес этого компьютера')
  })

  it('names the router’s own page when it is known (#128)', () => {
    const content = errorContent({
      kind: 'cannot-host',
      problem: 'unsupported',
      port: 47000,
      localAddress: '192.168.1.42',
      gateway: '192.168.1.1',
    })
    expect(content.tips[0]?.text).toContain('http://192.168.1.1')
    expect(content.tips[1]?.text).toContain('http://192.168.1.1')
  })

  it('a port closed from outside: UPnP, forwarding, then the provider (#128)', () => {
    const content = cannotHost('closed')
    expect(content.text).toContain('порт закрыт')
    expect(content.tips.map((t) => t.title)).toEqual([
      'Включить UPnP',
      'Пробросить порт вручную',
      'Проверить, нет ли общего адреса провайдера (CGNAT)',
      'Выбрать другого организатора',
      'Tailscale',
    ])
  })

  it('tells how to see CGNAT on the router’s page, with the address from outside (#128)', () => {
    const tip = errorContent({
      kind: 'cannot-host',
      problem: 'unsupported',
      port: 47000,
      localAddress: '192.168.1.42',
      externalAddress: '109.252.129.196',
    }).tips[2]
    expect(tip?.text).toContain('адрес WAN')
    expect(tip?.text).toContain('100.64–100.127')
    expect(tip?.text).toContain('не совпадает с внешним адресом этого компьютера (109.252.129.196)')
    expect(cannotHost('unsupported').tips[2]?.text).not.toContain('не совпадает')
  })

  it('gives only the owner’s two tips for a VPN (#60)', () => {
    const content = cannotHost('vpn')

    expect(content.text).toContain('VPN')
    expect(content.tips.map((t) => t.title)).toEqual([
      'Выключить VPN',
      'Или добавить Tolki в исключения VPN',
    ])
    expect(JSON.stringify(content)).not.toContain('Tailscale')
  })

  it('does not suggest manual forwarding where it cannot help', () => {
    expect(cannotHost('cgnat').tips[0]?.title).toBe('Подключить белый IP у провайдера')
    expect(cannotHost('double-nat').tips[0]?.title).toBe('Убрать второй роутер')
    expect(cannotHost('no-gateway').tips[0]?.title).toBe('Проверить подключение')
  })

  it.each<HostingProblem>(['refused', 'bad-address', 'mapping-disabled'])(
    'explains «%s» and suggests manual forwarding',
    (problem) => {
      expect(cannotHost(problem).text).not.toBe('')
      expect(
        cannotHost(problem)
          .tips.map((t) => t.title)
          .slice(0, 2),
      ).toEqual(['Включить UPnP', 'Пробросить порт вручную'])
    },
  )

  it('names the closed room and tells newer links from version mismatch', () => {
    expect(errorContent({ kind: 'host-closed', roomName: 'Кино' }).text).toContain('«Кино»')
    expect(errorContent({ kind: 'connection-lost', roomName: 'Кино' }).text).toContain('«Кино»')
    expect(errorContent({ kind: 'update-required', reason: 'newer-link' }).text).toContain(
      'более новой',
    )
    expect(errorContent({ kind: 'update-required', reason: 'host-version' }).text).toContain(
      'разные версии',
    )
  })
})
