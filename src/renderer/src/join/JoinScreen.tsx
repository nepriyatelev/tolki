import ArrowLeft from 'lucide-solid/icons/arrow-left'
import { Match, Switch, type JSX } from 'solid-js'
import { inviteErrorMessage, type Invite, type InviteParseResult } from '@shared/invite'
import { Button, Card } from '../ui'
import './JoinScreen.css'

export function inviteAddress(invite: Invite): string {
  const host = invite.hostKind === 'ipv6' ? `[${invite.host}]` : invite.host
  return `${host}:${invite.port}`
}

/**
 * "Вход по ссылке" opened from an invite link (issue #12). Shows what the link contains;
 * the full screen with name, password and microphone check is issue #17.
 */
export function JoinScreen(props: { result: InviteParseResult; onBack: () => void }): JSX.Element {
  const back = (): void => {
    props.onBack()
  }
  return (
    <main class="join">
      <Card as="section" class="join-card" aria-labelledby="join-title">
        <Switch>
          <Match when={props.result.ok ? props.result.invite : undefined}>
            {(invite) => (
              <>
                <h1 id="join-title">Вход по ссылке</h1>
                <dl class="join-details">
                  <dt>Хост</dt>
                  <dd class="join-mono">{inviteAddress(invite())}</dd>
                  <dt>Комната</dt>
                  <dd class="join-mono">{invite().roomId}</dd>
                  <dt>Пароль</dt>
                  <dd>{invite().password !== undefined ? 'вшит в ссылку' : 'спроси у хоста'}</dd>
                  <dt>Сертификат</dt>
                  <dd>
                    <span class="join-mono">{invite().fingerprint.slice(0, 12)}…</span> — сверим при
                    подключении
                  </dd>
                </dl>
              </>
            )}
          </Match>
          <Match when={!props.result.ok ? props.result.error : undefined}>
            {(error) => (
              <>
                <h1 id="join-title">Не получилось открыть ссылку</h1>
                <p class="join-error">{inviteErrorMessage(error())}</p>
              </>
            )}
          </Match>
        </Switch>
        <Button icon={<ArrowLeft />} onClick={back}>
          Назад
        </Button>
      </Card>
    </main>
  )
}
