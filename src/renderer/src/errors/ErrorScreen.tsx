import AlertTriangle from 'lucide-solid/icons/triangle-alert'
import CloudOff from 'lucide-solid/icons/cloud-off'
import Download from 'lucide-solid/icons/download'
import DoorClosed from 'lucide-solid/icons/door-closed'
import KeyRound from 'lucide-solid/icons/key-round'
import UserX from 'lucide-solid/icons/user-x'
import Users from 'lucide-solid/icons/users'
import WifiOff from 'lucide-solid/icons/wifi-off'
import { For, Show, type JSX } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { Card } from '../ui'
import { errorContent, type ErrorKind } from './error-content'
import './ErrorScreen.css'

const ICONS: Record<ErrorKind['kind'], (props: { class?: string }) => JSX.Element> = {
  'cannot-host': WifiOff,
  'host-offline': CloudOff,
  'too-many-attempts': KeyRound,
  'host-closed': DoorClosed,
  'connection-lost': AlertTriangle,
  removed: UserX,
  'room-full': Users,
  'update-required': Download,
}

/** Shared layout of the error screens (PLAN #18): what happened, why, what to do. */
export function ErrorScreen(props: { error: ErrorKind; actions: JSX.Element }): JSX.Element {
  const content = () => errorContent(props.error)
  return (
    <main class="error-screen">
      <Card as="section" class="error-card" aria-labelledby="error-title">
        <span class={`error-icon error-icon--${content().tone}`} aria-hidden="true">
          <Dynamic component={ICONS[props.error.kind]} />
        </span>
        <h1 id="error-title">{content().title}</h1>
        <p class="error-text">{content().text}</p>
        <Show when={content().tips.length > 0}>
          <section class="error-tips" aria-labelledby="error-tips-title">
            <h2 id="error-tips-title">Что можно сделать</h2>
            <ol>
              <For each={content().tips}>
                {(tip) => (
                  <li>
                    <strong>{tip.title}</strong>
                    <span>{tip.text}</span>
                  </li>
                )}
              </For>
            </ol>
          </section>
        </Show>
        <div class="error-actions">{props.actions}</div>
      </Card>
    </main>
  )
}
