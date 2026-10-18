import Download from 'lucide-solid/icons/download'
import X from 'lucide-solid/icons/x'
import { createResource, createSignal, Show, type JSX } from 'solid-js'
import { Button, IconButton } from '../ui'
import './UpdateBanner.css'

/**
 * «Доступна версия X» (PLAN #36): main asks GitHub once per run; the banner can be put away
 * until the next launch.
 */
export function UpdateBanner(): JSX.Element {
  const [update] = createResource(() => window.ratatosk.app.checkUpdate().catch(() => null))
  const [hidden, setHidden] = createSignal(false)
  return (
    <Show when={!hidden() && update()}>
      {(latest) => (
        <div class="update-banner" role="status">
          <span>Доступна версия {latest().version}</span>
          <span class="update-banner__actions">
            <Button
              variant="primary"
              icon={<Download />}
              onClick={() => void window.ratatosk.app.openDownloadPage()}
            >
              Скачать
            </Button>
            <IconButton
              variant="ghost"
              label="Скрыть"
              icon={<X />}
              onClick={() => setHidden(true)}
            />
          </span>
        </div>
      )}
    </Show>
  )
}
