import ArrowRight from 'lucide-solid/icons/arrow-right'
import Link from 'lucide-solid/icons/link'
import Plus from 'lucide-solid/icons/plus'
import { createSignal, type JSX } from 'solid-js'
import { inviteErrorMessage, parseInvite, type InviteParseResult } from '@shared/invite'
import type { RecentRoom } from '@shared/recent'
import { Button, Card, Input } from '../ui'
import { NetworkStatusBar } from './NetworkStatusBar'
import { RecentRooms } from './RecentRooms'
import { UpdateBanner } from './UpdateBanner'

export interface HomeScreenProps {
  profileName: string
  onOpenInvite: (result: InviteParseResult) => void
  onOpenRecent: (room: RecentRoom) => void
  onCreateRoom: () => void
}

/** Home screen (mockup 1, PLAN #15). */
export function HomeScreen(props: HomeScreenProps): JSX.Element {
  const [link, setLink] = createSignal('')
  const [linkError, setLinkError] = createSignal<string | undefined>(undefined)

  const join = (event: SubmitEvent): void => {
    event.preventDefault()
    if (link().trim() === '') {
      setLinkError('Нужна ссылка-приглашение')
      return
    }
    const result = parseInvite(link())
    if (!result.ok) {
      setLinkError(inviteErrorMessage(result.error))
      return
    }
    setLinkError(undefined)
    props.onOpenInvite(result)
  }

  return (
    <>
      <main class="home">
        <h1 class="visually-hidden">Tolki</h1>
        <UpdateBanner />
        <div class="home-cards">
          <Card as="section" aria-labelledby="create-title">
            <span class="home-card-icon home-card-icon--accent">
              <Plus />
            </span>
            <h2 id="create-title">Создать комнату</h2>
            <p>
              Этот компьютер станет организатором. Участники подключаются по ссылке напрямую к нему.
            </p>
            <Button
              variant="primary"
              iconEnd={<ArrowRight />}
              onClick={() => {
                props.onCreateRoom()
              }}
            >
              Создать комнату
            </Button>
          </Card>
          <Card as="section" aria-labelledby="join-link-title">
            <span class="home-card-icon">
              <Link />
            </span>
            <h2 id="join-link-title">Войти по ссылке</h2>
            <p>Ссылку можно вставить сюда или просто открыть — приложение подхватит её само.</p>
            <form class="home-link-form" onSubmit={join} novalidate>
              <Input
                label="Ссылка-приглашение"
                mono
                placeholder="tolki://join?h=…"
                autocomplete="off"
                spellcheck={false}
                value={link()}
                onInput={(e) => {
                  setLink(e.currentTarget.value)
                  setLinkError(undefined)
                }}
                error={linkError()}
              />
              <Button type="submit">Войти</Button>
            </form>
          </Card>
        </div>
        <RecentRooms
          onOpen={(room) => {
            props.onOpenRecent(room)
          }}
        />
      </main>
      <NetworkStatusBar />
    </>
  )
}
