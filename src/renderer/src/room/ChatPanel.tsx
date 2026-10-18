import SendHorizontal from 'lucide-solid/icons/send-horizontal'
import X from 'lucide-solid/icons/x'
import { createEffect, createSignal, For, on, onMount, Show, type JSX } from 'solid-js'
import { CHAT_MAX_LENGTH, chatParts } from '@shared/chat'
import { IconButton } from '../ui'
import './ChatPanel.css'

export interface ChatMessage {
  id: number
  peerId: string
  /** As it was when the message came: the sender may have left since. */
  name: string
  me: boolean
  text: string
  /** When it came, by this computer's clock. */
  time: number
}

export type ChatSendResult = 'sent' | 'too-many' | 'failed'

const clock = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' })

/**
 * The mini chat (#45): text and links, for this call only. Enter sends, Shift+Enter starts a
 * new line. Links open in the browser; nothing else in a message is clickable.
 */
export function ChatPanel(props: {
  messages: ChatMessage[]
  onSend: (text: string) => Promise<ChatSendResult>
  onOpenLink: (url: string) => void
  onClose: () => void
}): JSX.Element {
  const [draft, setDraft] = createSignal('')
  const [note, setNote] = createSignal<string | null>(null)
  const [sending, setSending] = createSignal(false)
  let list: HTMLOListElement | undefined
  let field: HTMLTextAreaElement | undefined
  const toBottom = (): void => {
    if (list) list.scrollTop = list.scrollHeight
  }

  onMount(() => {
    field?.focus()
    toBottom()
  })
  // A new message scrolls into view, unless the user scrolled up to read earlier ones.
  let atBottom = true
  createEffect(
    on(
      () => props.messages.length,
      () => {
        if (atBottom) toBottom()
      },
      { defer: true },
    ),
  )

  const send = async (): Promise<void> => {
    const text = draft().trim()
    if (text === '' || sending()) return
    setSending(true)
    const result = await props.onSend(text)
    setSending(false)
    if (result === 'sent') {
      setDraft('')
      setNote(null)
      atBottom = true
    } else {
      setNote(
        result === 'too-many'
          ? 'Слишком много сообщений подряд — отправка через пару секунд.'
          : 'Сообщение не отправилось.',
      )
    }
    field?.focus()
  }

  /** The name and time only when the sender changes or a minute passes. */
  const startsGroup = (index: number): boolean => {
    const message = props.messages[index]
    const before = props.messages[index - 1]
    if (!message || !before) return true
    return (
      before.peerId !== message.peerId || clock.format(before.time) !== clock.format(message.time)
    )
  }

  return (
    <aside class="chat" aria-label="Чат">
      <header class="chat-header">
        <h2>Чат</h2>
        <IconButton
          label="Закрыть чат"
          icon={<X />}
          variant="ghost"
          onClick={() => {
            props.onClose()
          }}
        />
      </header>
      <ol
        ref={(element) => {
          list = element
        }}
        class="chat-messages"
        aria-live="polite"
        onScroll={() => {
          if (list) atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 24
        }}
      >
        <Show when={props.messages.length === 0}>
          <li class="chat-empty">
            Сообщения видны только участникам этого звонка и не сохраняются.
          </li>
        </Show>
        <For each={props.messages}>
          {(message, index) => (
            <li class="chat-message" classList={{ 'chat-message--grouped': !startsGroup(index()) }}>
              <Show when={startsGroup(index())}>
                <p class="chat-meta">
                  <span class="chat-name">{message.name}</span>
                  <Show when={message.me}>
                    <span class="chat-you">я</span>
                  </Show>
                  <time>{clock.format(message.time)}</time>
                </p>
              </Show>
              <p class="chat-text">
                <For each={chatParts(message.text)}>
                  {(part) =>
                    part.kind === 'link' ? (
                      <a
                        href={part.url}
                        onClick={(event) => {
                          event.preventDefault()
                          props.onOpenLink(part.url)
                        }}
                      >
                        {part.url}
                      </a>
                    ) : (
                      part.text
                    )
                  }
                </For>
              </p>
            </li>
          )}
        </For>
      </ol>
      <Show when={note()}>
        {(text) => (
          <p class="chat-note" role="status">
            {text()}
          </p>
        )}
      </Show>
      <form
        class="chat-form"
        onSubmit={(event) => {
          event.preventDefault()
          void send()
        }}
      >
        <textarea
          ref={(element) => {
            field = element
          }}
          class="chat-field"
          aria-label="Сообщение"
          placeholder="Сообщение"
          rows={2}
          maxLength={CHAT_MAX_LENGTH}
          value={draft()}
          onInput={(event) => {
            setDraft(event.currentTarget.value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
              event.preventDefault()
              void send()
            } else if (event.key === 'Escape') {
              props.onClose()
            }
          }}
        />
        <IconButton
          type="submit"
          label="Отправить"
          variant="accent"
          icon={<SendHorizontal />}
          disabled={draft().trim() === '' || sending()}
        />
      </form>
    </aside>
  )
}
