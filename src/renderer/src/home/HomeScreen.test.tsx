import { render, screen, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { RecentRoom } from '@shared/recent'
import { installTolkiMock, PUBLIC_IPV4_CHECK } from '../../../test/tolki-mock'
import { HomeScreen } from './HomeScreen'

const FP = '2_SqXt3l45Ay59VWqBcvcLmeh7BmqvL0m-UwbNw3EiE'
const LINK = `tolki://join?v=1&h=203.0.113.5&p=47000&r=vecherniy&fp=${FP}`
const room = (id: string, roomName: string, passwordSaved = false): RecentRoom => ({
  id,
  invite: { host: '203.0.113.5', hostKind: 'ipv4', port: 47000, roomId: id, fingerprint: FP },
  roomName,
  lastUsedAt: Date.now(),
  passwordSaved,
})

function show(options: Parameters<typeof installTolkiMock>[0] = {}, profileName = '') {
  const api = installTolkiMock(options)
  const onOpenInvite = vi.fn()
  const onOpenRecent = vi.fn()
  const onCreateRoom = vi.fn()
  render(() => (
    <HomeScreen
      profileName={profileName}
      onOpenInvite={onOpenInvite}
      onOpenRecent={onOpenRecent}
      onCreateRoom={onCreateRoom}
    />
  ))
  return { api, onOpenInvite, onOpenRecent, onCreateRoom, user: userEvent.setup() }
}

describe('HomeScreen', () => {
  it('stays neutral: no greeting and no chatty question (#88)', () => {
    show({}, 'Алексей')

    expect(screen.queryByText(/Привет/)).toBeNull()
    expect(screen.queryByText(/созвонимся/)).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: 'Tolki' })).toBeTruthy()
  })

  it('goes to room creation', async () => {
    const { onCreateRoom, user } = show()

    await user.click(screen.getByRole('button', { name: 'Создать комнату' }))

    expect(onCreateRoom).toHaveBeenCalledOnce()
  })

  it('opens a pasted invite link', async () => {
    const { onOpenInvite, user } = show()

    await user.type(screen.getByLabelText('Ссылка-приглашение'), LINK)
    await user.click(screen.getByRole('button', { name: 'Войти' }))

    expect(onOpenInvite).toHaveBeenCalledOnce()
    expect(onOpenInvite.mock.calls[0]?.[0]).toMatchObject({
      ok: true,
      invite: { roomId: 'vecherniy' },
    })
  })

  it('explains an empty or broken link right under the field', async () => {
    const { onOpenInvite, user } = show()

    await user.click(screen.getByRole('button', { name: 'Войти' }))
    expect(screen.getByText('Нужна ссылка-приглашение')).toBeTruthy()

    await user.type(screen.getByLabelText('Ссылка-приглашение'), 'https://example.com')
    await user.click(screen.getByRole('button', { name: 'Войти' }))
    expect(screen.getByText('Это не ссылка-приглашение Tolki.')).toBeTruthy()
    expect(onOpenInvite).not.toHaveBeenCalled()
  })

  it('lists recent rooms with only the number of people and opens them', async () => {
    const live = room('a', 'Вечерний созвон', true)
    const offline = room('b', 'Кино по пятницам')
    const { onOpenRecent, user } = show({
      recentRooms: [live, offline],
      recentStatuses: { a: { status: 'live', peerCount: 2 }, b: { status: 'offline' } },
    })

    const rows = await screen.findAllByRole('listitem')
    expect(within(rows[0] as HTMLElement).getByText('Вечерний созвон')).toBeTruthy()
    expect(await within(rows[0] as HTMLElement).findByText('Идёт · 2 человека')).toBeTruthy()
    expect(within(rows[0] as HTMLElement).getByText(/пароль сохранён/)).toBeTruthy()
    expect(within(rows[1] as HTMLElement).getByText('Организатор не в сети')).toBeTruthy()

    await user.click(within(rows[0] as HTMLElement).getByRole('button', { name: 'Подключиться' }))
    expect(onOpenRecent).toHaveBeenCalledWith(live)
  })

  it('removes a room from the list', async () => {
    const { api, user } = show({ recentRooms: [room('a', 'Вечерний созвон')] })

    await user.click(
      await screen.findByRole('button', { name: 'Убрать «Вечерний созвон» из недавних' }),
    )

    expect(api.recent.remove).toHaveBeenCalledWith('a')
    expect(await screen.findByText('Здесь появятся комнаты после первого входа.')).toBeTruthy()
  })

  it('does not offer to connect when the certificate changed', async () => {
    show({
      recentRooms: [room('a', 'Вечерний созвон')],
      recentStatuses: { a: { status: 'certificate-changed' } },
    })

    expect(await screen.findByText('Сертификат изменился')).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Подключиться' }).disabled).toBe(
      true,
    )
  })
})

describe('new version banner (#36)', () => {
  it('offers the newer version and opens the download page', async () => {
    const { api, user } = show({ update: { version: '0.2.0', ready: false } })
    expect(await screen.findByText('Доступна версия 0.2.0')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Скачать' }))
    expect(api.app.openDownloadPage).toHaveBeenCalledOnce()
  })

  it('can be put away', async () => {
    const { user } = show({ update: { version: '0.2.0', ready: false } })
    await screen.findByText('Доступна версия 0.2.0')
    await user.click(screen.getByRole('button', { name: 'Скрыть' }))
    expect(screen.queryByText('Доступна версия 0.2.0')).toBeNull()
  })

  it('offers to restart once the new version is downloaded (#46)', async () => {
    const { api, user } = show()
    await vi.waitFor(() => {
      expect(api.app.checkUpdate).toHaveBeenCalled()
    })
    api.app.emitUpdate({ version: '0.2.0', ready: true })
    expect(
      await screen.findByText('Версия 0.2.0 загружена и установится при выходе из Tolki'),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Скачать' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Перезапустить' }))
    expect(api.app.installUpdate).toHaveBeenCalledOnce()
  })

  it('is not there when the app is up to date', async () => {
    const { api } = show()
    await vi.waitFor(() => {
      expect(api.app.checkUpdate).toHaveBeenCalled()
    })
    expect(screen.queryByText(/Доступна версия/)).toBeNull()
  })

  it('puts «cannot host» over the cards, as a warning, and not in the footer (#110)', async () => {
    const { user, api } = show({
      check: () =>
        Promise.resolve({ ...PUBLIC_IPV4_CHECK, verdict: { canHost: false, problem: 'cgnat' } }),
    })

    const notice = await screen.findByRole('status', { name: 'Состояние сети' })
    const cards = screen.getByRole('region', { name: 'Создать комнату' })
    expect(notice.compareDocumentPosition(cards) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(notice).getByText(/не может быть организатором/)).toBeTruthy()
    expect(within(notice).getByText(/белый IP/)).toBeTruthy()
    expect(document.querySelector('footer')?.textContent).toBe('')

    await user.click(within(notice).getByRole('button', { name: 'Проверить снова' }))
    expect(api.network.check).toHaveBeenLastCalledWith({ force: true })
  })

  it('keeps a good verdict quietly in the footer (#110)', async () => {
    show()
    expect(
      await screen.findByText('Этот компьютер может быть организатором: порт открыт через UPnP'),
    ).toBeTruthy()
    expect(screen.queryByRole('status', { name: 'Состояние сети' })).toBeNull()
  })
})
