import X from 'lucide-solid/icons/x'
import { createResource, createSignal, For, Show, type JSX } from 'solid-js'
import type { RecentRoom } from '@shared/recent'
import { Avatar, Button, Chip, IconButton } from '../ui'
import { describeRecentStatus, recentSubtitle } from './recent-text'
import './RecentRooms.css'

export interface RecentRoomsProps {
  onOpen: (room: RecentRoom) => void
}

/** "Недавние комнаты" (mockup 1): what this device joined before, with a live status. */
export function RecentRooms(props: RecentRoomsProps): JSX.Element {
  const [rooms, setRooms] = createSignal<RecentRoom[] | undefined>(undefined)
  void window.ratatosk.recent.list().then(setRooms)
  // The light check runs once per visit of the home screen.
  const [statuses] = createResource(() => window.ratatosk.recent.probe())

  const remove = async (room: RecentRoom): Promise<void> => {
    setRooms(await window.ratatosk.recent.remove(room.id))
  }

  return (
    <section class="recent" aria-labelledby="recent-title">
      <div class="recent-header">
        <h2 id="recent-title">Недавние комнаты</h2>
        <span class="recent-note">Хранятся только на этом устройстве</span>
      </div>
      <Show
        when={(rooms()?.length ?? 0) > 0}
        fallback={
          <Show when={rooms() !== undefined}>
            <p class="recent-empty">Здесь появятся комнаты, в которые ты заходил.</p>
          </Show>
        }
      >
        <ul class="recent-list">
          <For each={rooms()}>
            {(room) => {
              const status = () => statuses.latest?.[room.id]
              const chip = () => describeRecentStatus(status())
              return (
                <li class="recent-row">
                  <Avatar name={room.roomName} size="lg" shape="square" />
                  <div class="recent-text">
                    <span class="recent-name">{room.roomName}</span>
                    <span class="recent-subtitle">{recentSubtitle(room)}</span>
                  </div>
                  <Chip tone={chip().tone} dot={chip().dot}>
                    {chip().text}
                  </Chip>
                  <Button
                    variant={status()?.status === 'live' ? 'primary' : 'ghost'}
                    disabled={status()?.status === 'certificate-changed'}
                    onClick={() => {
                      props.onOpen(room)
                    }}
                  >
                    Подключиться
                  </Button>
                  <IconButton
                    label={`Убрать «${room.roomName}» из недавних`}
                    icon={<X />}
                    variant="ghost"
                    onClick={() => void remove(room)}
                  />
                </li>
              )
            }}
          </For>
        </ul>
      </Show>
    </section>
  )
}
