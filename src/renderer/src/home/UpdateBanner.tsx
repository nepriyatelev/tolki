import Download from 'lucide-solid/icons/download'
import RotateCw from 'lucide-solid/icons/rotate-cw'
import X from 'lucide-solid/icons/x'
import { createSignal, onCleanup, onMount, Show, type JSX } from 'solid-js'
import type { UpdateOffer } from '@shared/ipc'
import { Button, IconButton } from '../ui'
import './UpdateBanner.css'

/**
 * A newer version (PLAN #36, #46). Where Tolki updates itself it is downloaded already and
 * installs on quit, «Перезапустить» does it now; elsewhere «Скачать» opens the download page.
 * The banner can be put away until the next launch.
 */
export function UpdateBanner(): JSX.Element {
  const [offer, setOffer] = createSignal<UpdateOffer>(null)
  const [hidden, setHidden] = createSignal(false)
  onMount(() => {
    void window.tolki.app
      .checkUpdate()
      .then((found) => {
        // A download that finished meanwhile wins over the first answer.
        if (!offer()?.ready) setOffer(found)
      })
      .catch(() => undefined)
    onCleanup(window.tolki.app.onUpdate(setOffer))
  })
  return (
    <Show when={!hidden() && offer()}>
      {(latest) => (
        <div class="update-banner" role="status">
          <Show when={latest().ready} fallback={<span>Доступна версия {latest().version}</span>}>
            <span>Версия {latest().version} загружена и установится при выходе из Tolki</span>
          </Show>
          <span class="update-banner__actions">
            <Show
              when={latest().ready}
              fallback={
                <Button
                  variant="primary"
                  icon={<Download />}
                  onClick={() => void window.tolki.app.openDownloadPage()}
                >
                  Скачать
                </Button>
              }
            >
              <Button
                variant="primary"
                icon={<RotateCw />}
                onClick={() => void window.tolki.app.installUpdate()}
              >
                Перезапустить
              </Button>
            </Show>
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
