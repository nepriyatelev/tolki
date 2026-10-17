import Check from 'lucide-solid/icons/check'
import Minus from 'lucide-solid/icons/minus'
import X from 'lucide-solid/icons/x'
import { For, Match, Show, Switch, type JSX } from 'solid-js'
import type { PortMappingMethod } from '@shared/host-protocol'
import { classifyIPv4, type NetworkCheckResult } from '@shared/network'
import { describeHosting } from '../home/hosting-status'
import { UploadEstimate } from '../room/UploadEstimate'
import { Card } from '../ui'

const METHOD: Record<PortMappingMethod, string> = { pcp: 'PCP', 'nat-pmp': 'NAT-PMP', upnp: 'UPnP' }

type Tone = 'ok' | 'bad' | 'neutral'
interface Item {
  tone: Tone
  text: string
}

/** The checklist of mockup 2's «Проверка сети», in plain words. */
export function networkCheckItems(result: NetworkCheckResult): Item[] {
  const mapping = result.portMapping
  const port: Item =
    mapping.status === 'mapped'
      ? { tone: 'ok', text: `Порт ${result.port} открыт через ${METHOD[mapping.method]}` }
      : mapping.status === 'disabled'
        ? { tone: 'neutral', text: 'Автоматический проброс порта выключен' }
        : { tone: 'bad', text: `Порт ${result.port} не удалось открыть автоматически` }
  const address: Item =
    mapping.status === 'mapped'
      ? {
          tone: classifyIPv4(mapping.externalAddress) === 'public' ? 'ok' : 'bad',
          text: `Внешний адрес: ${mapping.externalAddress}`,
        }
      : { tone: 'neutral', text: 'Внешний адрес неизвестен' }
  const ipv6: Item =
    result.ipv6Address !== null
      ? { tone: 'ok', text: 'IPv6 доступен' }
      : { tone: 'neutral', text: 'IPv6 нет' }
  return [port, address, ipv6]
}

function ItemIcon(props: { tone: Tone }): JSX.Element {
  return (
    <span class={`check-icon check-icon--${props.tone}`} aria-hidden="true">
      <Switch>
        <Match when={props.tone === 'ok'}>
          <Check />
        </Match>
        <Match when={props.tone === 'bad'}>
          <X />
        </Match>
        <Match when={props.tone === 'neutral'}>
          <Minus />
        </Match>
      </Switch>
    </span>
  )
}

export function NetworkCheckCard(props: {
  result: NetworkCheckResult | undefined
  loading: boolean
  onRetry: () => void
}): JSX.Element {
  return (
    <Card as="section" padding="md" class="network-card" aria-labelledby="network-card-title">
      <h2 id="network-card-title">Проверка сети</h2>
      <Show
        when={!props.loading ? props.result : undefined}
        fallback={<p class="network-card-muted">Проверяем сеть…</p>}
      >
        {(result) => {
          const summary = () => describeHosting(result())
          return (
            <>
              <ul class="network-card-items">
                <For each={networkCheckItems(result())}>
                  {(item) => (
                    <li>
                      <ItemIcon tone={item.tone} />
                      {item.text}
                    </li>
                  )}
                </For>
              </ul>
              <UploadEstimate class="network-card-upload" />
              <div
                class="network-card-summary"
                classList={{ 'network-card-summary--bad': summary().tone === 'bad' }}
              >
                <Show
                  when={summary().tone === 'ok'}
                  fallback={
                    <>
                      <strong>{summary().title}</strong>
                      <span>{summary().details[0]}</span>
                    </>
                  }
                >
                  Друзья смогут подключиться к тебе напрямую.
                </Show>
              </div>
              <button
                type="button"
                class="network-card-retry"
                onClick={() => {
                  props.onRetry()
                }}
              >
                Проверить снова
              </button>
            </>
          )
        }}
      </Show>
    </Card>
  )
}
