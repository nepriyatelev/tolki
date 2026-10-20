import Ellipsis from 'lucide-solid/icons/ellipsis'
import MicOff from 'lucide-solid/icons/mic-off'
import RotateCcw from 'lucide-solid/icons/rotate-ccw'
import Settings from 'lucide-solid/icons/settings'
import UserX from 'lucide-solid/icons/user-x'
import Volume2 from 'lucide-solid/icons/volume-2'
import { createSignal, createUniqueId, Show, type JSX } from 'solid-js'
import { MAX_PEER_VOLUME } from '@shared/settings'
import { Avatar, Button, IconButton } from '../ui'

export interface TilePerson {
  id: string
  name: string
  me: boolean
  /** The room is on their computer (#87). */
  organizer?: boolean | undefined
}

/**
 * A participant's tile (mockup 4) with a «⋯» menu. For someone else the menu holds their volume
 * in your ears (0–200 %, only for you, remembered by name — #23, #77); for yourself, the audio
 * settings.
 */
export function ParticipantTile(props: {
  person: TilePerson
  speaking: boolean
  muted: boolean
  /** Percent; ignored on your own tile. */
  volume: number
  onVolumePreview: (volume: number) => void
  onVolumeSave: (volume: number) => void
  onOpenSettings: () => void
  /** The organizer only, on someone else's tile (#42): remove them from the room. */
  onRemove?: (() => void) | undefined
}): JSX.Element {
  /** «Удалить из комнаты» asks once more before it acts. */
  const [confirming, setConfirming] = createSignal(false)
  const menuId = `tile-menu-${createUniqueId()}`
  let button: HTMLButtonElement | undefined
  let menu: HTMLDivElement | undefined
  const [open, setOpen] = createSignal(false)
  const changed = (): boolean => !props.person.me && props.volume !== 100

  const toggleMenu = (): void => {
    if (!menu) return
    if (open()) menu.hidePopover()
    else menu.showPopover()
  }

  /** The popover closes on Esc or a click outside; focus goes back to «⋯» if it was inside. */
  const onToggle = (event: Event): void => {
    const opening = (event as ToggleEvent).newState === 'open'
    setOpen(opening)
    if (!opening) setConfirming(false)
    if (opening) {
      menu?.querySelector<HTMLElement>('input, button')?.focus()
    } else if (!document.activeElement || document.activeElement === document.body) {
      button?.focus()
    } else if (menu?.contains(document.activeElement)) {
      button?.focus()
    }
  }

  const label = (): string =>
    props.person.name +
    (props.person.me ? ' (я)' : '') +
    (props.person.organizer ? ', организатор' : '') +
    (props.speaking ? ', говорит' : '') +
    (props.muted ? ', микрофон выключен' : '') +
    (changed() ? `, громкость ${props.volume} %` : '')

  return (
    <li
      class="call-tile"
      classList={{ 'call-tile--speaking': props.speaking }}
      data-peer-id={props.person.id}
      // The «⋯» button anchors its popover (CSS anchor positioning), one name per tile.
      style={{
        '--tile-anchor': `--${menuId}`,
        // The same person in the grid and in the strip: one moves into the other (#149).
        'view-transition-name': `person-${props.person.id}`,
      }}
      data-flip={props.person.id}
      aria-label={label()}
    >
      <Avatar name={props.person.name} size="xl" speaking={props.speaking} />
      <span class="call-tile-name">
        <span class="call-tile-name-text">{props.person.name}</span>
        <Show when={props.person.me}>
          <span class="call-tile-you">я</span>
        </Show>
        <Show when={props.person.organizer}>
          <span class="call-tile-organizer">организатор</span>
        </Show>
        <Show when={props.muted}>
          <span class="call-tile-muted" role="img" aria-label="Микрофон выключен">
            <MicOff />
          </span>
        </Show>
        <Show when={changed()}>
          <span class="call-tile-volume" aria-hidden="true">
            <Volume2 />
            {props.volume}%
          </span>
        </Show>
      </span>
      {/* «⋯» in the tile's top-right corner, as in other call apps. */}
      <IconButton
        ref={(element) => {
          button = element
        }}
        // One class string: IconButton keeps its own classList.
        class={
          open() ? 'call-tile-menu-button call-tile-menu-button--open' : 'call-tile-menu-button'
        }
        label={`Меню: ${props.person.name}`}
        icon={<Ellipsis />}
        variant="secondary"
        shape="round"
        aria-haspopup="dialog"
        aria-expanded={open()}
        aria-controls={menuId}
        onClick={toggleMenu}
      />
      <div
        ref={(element) => {
          menu = element
        }}
        id={menuId}
        class="call-tile-menu"
        popover="auto"
        role="dialog"
        aria-label={props.person.me ? 'Мой звук' : `Звук: ${props.person.name}`}
        onToggle={onToggle}
      >
        <Show
          when={!props.person.me}
          fallback={
            <Button
              variant="ghost"
              icon={<Settings />}
              onClick={() => {
                menu?.hidePopover()
                props.onOpenSettings()
              }}
            >
              Настройки
            </Button>
          }
        >
          <div class="call-tile-menu-head">
            <span>Громкость</span>
            <span class="call-tile-menu-value">{props.volume}%</span>
          </div>
          <input
            type="range"
            class="call-volume-slider"
            min="0"
            max={MAX_PEER_VOLUME}
            step="5"
            value={props.volume}
            aria-label={`Громкость: ${props.person.name}`}
            aria-valuetext={`${props.volume} %`}
            onInput={(e) => {
              props.onVolumePreview(e.currentTarget.valueAsNumber)
            }}
            onChange={(e) => {
              props.onVolumeSave(e.currentTarget.valueAsNumber)
            }}
          />
          <p class="call-tile-menu-note">
            Меняется только на этом компьютере и запоминается для этого имени.
          </p>
          <Button
            variant="ghost"
            icon={<RotateCcw />}
            disabled={props.volume === 100}
            onClick={() => {
              props.onVolumeSave(100)
            }}
          >
            Сбросить до 100 %
          </Button>
          <Show when={props.onRemove}>
            {(remove) => (
              <Show
                when={confirming()}
                fallback={
                  <Button
                    variant="ghost"
                    class="call-tile-remove"
                    icon={<UserX />}
                    onClick={() => setConfirming(true)}
                  >
                    Удалить из комнаты
                  </Button>
                }
              >
                <p class="call-tile-menu-note">
                  {props.person.name} отключится. Войти снова можно по той же ссылке.
                </p>
                <div class="call-tile-confirm">
                  <Button variant="ghost" onClick={() => setConfirming(false)}>
                    Отмена
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => {
                      menu?.hidePopover()
                      remove()()
                    }}
                  >
                    Удалить
                  </Button>
                </div>
              </Show>
            )}
          </Show>
        </Show>
      </div>
    </li>
  )
}
