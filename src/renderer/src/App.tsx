import { createSignal, Match, onCleanup, onMount, Switch, type JSX } from 'solid-js'
import { APP_NAME } from '@shared/app'
import type { InviteParseResult } from '@shared/invite'
import logo from './assets/logo.svg'
import { HomeScreen } from './home/HomeScreen'
import { JoinScreen } from './join/JoinScreen'
import './App.css'

type Route = { screen: 'home' } | { screen: 'join'; result: InviteParseResult }

export function App(): JSX.Element {
  const [route, setRoute] = createSignal<Route>({ screen: 'home' })
  const openInvite = (result: InviteParseResult): void => {
    setRoute({ screen: 'join', result })
  }
  const joinResult = (): InviteParseResult | undefined => {
    const current = route()
    return current.screen === 'join' ? current.result : undefined
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
      </header>
      <Switch fallback={<HomeScreen />}>
        <Match when={joinResult()}>
          {(result) => (
            <JoinScreen
              result={result()}
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
