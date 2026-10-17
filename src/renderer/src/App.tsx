import Download from 'lucide-solid/icons/download'
import {
  createResource,
  createSignal,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
  type JSX,
} from 'solid-js'
import { APP_NAME } from '@shared/app'
import type { InviteParseResult } from '@shared/invite'
import type { RecentRoom } from '@shared/recent'
import logo from './assets/logo.svg'
import { CreateRoomScreen } from './create/CreateRoomScreen'
import type { ErrorKind } from './errors/error-content'
import { ErrorScreen } from './errors/ErrorScreen'
import { RetryButton } from './errors/RetryButton'
import { HomeScreen } from './home/HomeScreen'
import { JoinScreen, type RecentContext } from './join/JoinScreen'
import { Avatar, Button } from './ui'
import './App.css'

type JoinRoute = { screen: 'join'; result: InviteParseResult; recent?: RecentContext }
type Route =
  | { screen: 'home' }
  | { screen: 'create' }
  | JoinRoute
  /** `retry` goes back to where the error happened, e.g. the same invite. */
  | { screen: 'error'; error: ErrorKind; retry?: JoinRoute }

export function App(): JSX.Element {
  const [route, setRoute] = createSignal<Route>({ screen: 'home' })
  const [settings, { refetch: reloadSettings }] = createResource(() =>
    window.ratatosk.settings.get(),
  )
  const profileName = (): string => settings.latest?.profile.name ?? ''
  const home = (): void => {
    setRoute({ screen: 'home' })
  }

  const openInvite = (result: InviteParseResult): void => {
    if (!result.ok && result.error.code === 'unsupported-version') {
      setRoute({ screen: 'error', error: { kind: 'update-required', reason: 'newer-link' } })
      return
    }
    setRoute({ screen: 'join', result })
  }
  const openRecent = (room: RecentRoom): void => {
    setRoute({
      screen: 'join',
      result: { ok: true, invite: { ...room.invite } },
      recent: { id: room.id, passwordSaved: room.passwordSaved },
    })
  }
  const joinRoute = () => {
    const current = route()
    return current.screen === 'join' ? current : undefined
  }
  const errorRoute = () => {
    const current = route()
    return current.screen === 'error' ? current : undefined
  }

  onMount(() => {
    // A link may have started the app; later links arrive as events.
    onCleanup(window.ratatosk.invite.onOpened(openInvite))
    void window.ratatosk.invite.takePending().then((pending) => {
      if (pending) openInvite(pending)
    })
    // The room ended without the user leaving it.
    onCleanup(
      window.ratatosk.room.onClosed(({ reason, roomName }) => {
        setRoute({
          screen: 'error',
          error:
            reason === 'host-closed'
              ? { kind: 'host-closed', roomName }
              : { kind: 'connection-lost', roomName },
        })
      }),
    )
  })

  return (
    <div class="app">
      <header class="app-header">
        <img class="app-logo" src={logo} alt="" width="36" height="36" />
        <span class="app-name">{APP_NAME}</span>
        <Show when={profileName()}>
          {(name) => (
            <span class="app-user">
              <Avatar name={name()} size="sm" />
              {name()}
            </span>
          )}
        </Show>
      </header>
      <Switch
        fallback={
          <HomeScreen
            profileName={profileName()}
            onOpenInvite={openInvite}
            onOpenRecent={openRecent}
            onCreateRoom={() => setRoute({ screen: 'create' })}
          />
        }
      >
        <Match when={route().screen === 'create'}>
          <CreateRoomScreen
            profileName={profileName()}
            onOpened={() => void reloadSettings()}
            onBack={home}
          />
        </Match>
        <Match when={joinRoute()}>
          {(current) => (
            <JoinScreen
              result={current().result}
              recent={current().recent}
              profileName={profileName()}
              onJoined={() => void reloadSettings()}
              onError={(error) => setRoute({ screen: 'error', error, retry: current() })}
              onBack={home}
            />
          )}
        </Match>
        <Match when={errorRoute()}>
          {(current) => (
            <ErrorScreen
              error={current().error}
              actions={
                <>
                  <Show when={current().error.kind === 'update-required'}>
                    <Button
                      variant="primary"
                      icon={<Download />}
                      onClick={() => void window.ratatosk.app.openDownloadPage()}
                    >
                      Скачать новую версию
                    </Button>
                  </Show>
                  <Show when={current().retry}>
                    {(retry) => (
                      <RetryButton
                        waitSeconds={current().error.kind === 'too-many-attempts' ? 60 : 0}
                        onRetry={() => setRoute(retry())}
                      />
                    )}
                  </Show>
                  <Button onClick={home}>На главный экран</Button>
                </>
              }
            />
          )}
        </Match>
      </Switch>
    </div>
  )
}
