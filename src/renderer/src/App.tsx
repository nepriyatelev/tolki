import Download from 'lucide-solid/icons/download'
import {
  createResource,
  createSignal,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
  untrack,
  type JSX,
} from 'solid-js'
import type { InviteParseResult } from '@shared/invite'
import type { RecentRoom } from '@shared/recent'
import { CreateRoomScreen } from './create/CreateRoomScreen'
import type { ErrorKind } from './errors/error-content'
import { ErrorScreen } from './errors/ErrorScreen'
import { RetryButton } from './errors/RetryButton'
import { HomeScreen } from './home/HomeScreen'
import { JoinScreen, type RecentContext } from './join/JoinScreen'
import { Button, viewTransition } from './ui'
import './App.css'

type JoinRoute = { screen: 'join'; result: InviteParseResult; recent?: RecentContext }
type Route =
  | { screen: 'home' }
  | { screen: 'create' }
  | JoinRoute
  /** `retry` goes back to where the error happened, e.g. the same invite. */
  | { screen: 'error'; error: ErrorKind; retry?: JoinRoute }

export function App(): JSX.Element {
  const [route, setRouteNow] = createSignal<Route>({ screen: 'home' })
  // Screens become one another as a whole (#149), not in a cut.
  const setRoute = (next: Route): void => {
    viewTransition(() => setRouteNow(next))
  }
  const [settings, { refetch: reloadSettings }] = createResource(() => window.tolki.settings.get())
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
    onCleanup(window.tolki.invite.onOpened(openInvite))
    void window.tolki.invite.takePending().then((pending) => {
      if (pending) openInvite(pending)
    })
    // The room ended without the user leaving it.
    onCleanup(
      window.tolki.room.onClosed(({ reason, roomName }) => {
        const current = untrack(route)
        // A lost link (30 s of reconnecting, PLAN #31) can be retried with the same invite, and
        // so can a removal (#42): the organizer may let them back in.
        const retry =
          (reason === 'connection-lost' || reason === 'removed') && current.screen === 'join'
            ? current
            : undefined
        setRoute({
          screen: 'error',
          error:
            reason === 'host-closed'
              ? { kind: 'host-closed', roomName }
              : reason === 'removed'
                ? { kind: 'removed', roomName }
                : { kind: 'connection-lost', roomName },
          ...(retry ? { retry } : {}),
        })
      }),
    )
  })

  return (
    <div class="app">
      <Switch
        fallback={
          <HomeScreen
            profileName={profileName()}
            onOpenInvite={openInvite}
            onOpenRecent={openRecent}
            onCreateRoom={() => {
              setRoute({ screen: 'create' })
            }}
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
              onError={(error) => {
                setRoute({ screen: 'error', error, retry: current() })
              }}
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
                      onClick={() => void window.tolki.app.openDownloadPage()}
                    >
                      Скачать новую версию
                    </Button>
                  </Show>
                  <Show when={current().retry}>
                    {(retry) => (
                      <RetryButton
                        waitSeconds={current().error.kind === 'too-many-attempts' ? 60 : 0}
                        onRetry={() => {
                          setRoute(retry())
                        }}
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
