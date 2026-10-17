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
import { HomeScreen } from './home/HomeScreen'
import { JoinScreen, type RecentContext } from './join/JoinScreen'
import { Avatar } from './ui'
import './App.css'

type Route =
  | { screen: 'home' }
  | { screen: 'create' }
  | { screen: 'join'; result: InviteParseResult; recent?: RecentContext }

export function App(): JSX.Element {
  const [route, setRoute] = createSignal<Route>({ screen: 'home' })
  const [settings, { refetch: reloadSettings }] = createResource(() =>
    window.ratatosk.settings.get(),
  )
  const profileName = (): string => settings.latest?.profile.name ?? ''

  const openInvite = (result: InviteParseResult): void => {
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

  onMount(() => {
    // A link may have started the app; later links arrive as events.
    const off = window.ratatosk.invite.onOpened(openInvite)
    onCleanup(off)
    void window.ratatosk.invite.takePending().then((pending) => {
      if (pending) openInvite(pending)
    })
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
            onBack={() => {
              setRoute({ screen: 'home' })
            }}
          />
        </Match>
        <Match when={joinRoute()}>
          {(current) => (
            <JoinScreen
              result={current().result}
              recent={current().recent}
              profileName={profileName()}
              onJoined={() => void reloadSettings()}
              onBack={() => {
                setRoute({ screen: 'home' })
              }}
            />
          )}
        </Match>
      </Switch>
    </div>
  )
}
