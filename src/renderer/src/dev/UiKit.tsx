import ArrowRight from 'lucide-solid/icons/arrow-right'
import Copy from 'lucide-solid/icons/copy'
import Headphones from 'lucide-solid/icons/headphones'
import Link from 'lucide-solid/icons/link'
import Maximize from 'lucide-solid/icons/maximize'
import Mic from 'lucide-solid/icons/mic'
import MicOff from 'lucide-solid/icons/mic-off'
import Monitor from 'lucide-solid/icons/monitor'
import PhoneOff from 'lucide-solid/icons/phone-off'
import SlidersHorizontal from 'lucide-solid/icons/sliders-horizontal'
import { createSignal, type JSX } from 'solid-js'
import { Avatar, Button, Card, Checkbox, Chip, IconButton, Input, RadioPillGroup } from '../ui'
import './UiKit.css'

type ScreenMode = 'auto' | 'text' | 'motion'

/** Dev-only showcase of the base components (open the app with #ui-kit). */
export default function UiKit(): JSX.Element {
  const [muted, setMuted] = createSignal(false)
  const [embed, setEmbed] = createSignal(false)
  const [mode, setMode] = createSignal<ScreenMode>('auto')
  const [password, setPassword] = createSignal('')

  return (
    <main class="ui-kit">
      <h1>UI kit</h1>

      <section>
        <h2>Button</h2>
        <div class="ui-kit-row">
          <Button variant="primary" iconEnd={<ArrowRight />}>
            Создать комнату
          </Button>
          <Button variant="secondary">Сгенерировать</Button>
          <Button variant="secondary" icon={<Copy />}>
            Скопировать ссылку
          </Button>
          <Button variant="ghost">Подключиться</Button>
          <Button variant="danger">Выйти</Button>
          <Button variant="primary" disabled>
            Недоступно
          </Button>
          <Button variant="primary" size="lg">
            Открыть комнату
          </Button>
        </div>
      </section>

      <section>
        <h2>IconButton</h2>
        <div class="ui-kit-row">
          <IconButton label="Настройки" icon={<SlidersHorizontal />} />
          <IconButton label="Пригласить" icon={<Link />} variant="ghost" />
          <IconButton label="На весь экран" icon={<Maximize />} />
          <IconButton
            label={muted() ? 'Включить микрофон' : 'Выключить микрофон'}
            icon={muted() ? <MicOff /> : <Mic />}
            shape="round"
            size="lg"
            pressed={muted()}
            onClick={() => setMuted((m) => !m)}
          />
          <IconButton label="Звук" icon={<Headphones />} shape="round" size="lg" />
          <IconButton
            label="Показать свой экран"
            icon={<Monitor />}
            shape="round"
            size="lg"
            variant="accent"
          />
          <IconButton label="Выйти" icon={<PhoneOff />} shape="round" size="lg" variant="danger" />
        </div>
      </section>

      <section class="ui-kit-grid">
        <Card>
          <h2>Input · Checkbox · RadioPill</h2>
          <div class="ui-kit-stack">
            <Input label="Название комнаты" placeholder="Вечерний созвон" />
            <Input
              label="Пароль"
              mono
              placeholder="лиса-маяк-42"
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
              hint="Пустой пароль — войти сможет любой, у кого есть ссылка."
            />
            <Input label="Порт" mono value="80" error="Порт должен быть от 1024 до 65535" />
            <Checkbox
              label="Вшить пароль в ссылку"
              description="Удобнее: участникам не нужно ничего вводить. Безопаснее — отправить пароль отдельно."
              checked={embed()}
              onChange={(e) => setEmbed(e.currentTarget.checked)}
            />
            <RadioPillGroup
              legend="Демонстрация экрана"
              value={mode()}
              onChange={setMode}
              options={[
                { value: 'auto', label: 'Авто', description: 'Подстраивается под сеть' },
                { value: 'text', label: 'Чёткий текст', description: 'Код, документы · 15 к/с' },
                { value: 'motion', label: 'Плавно', description: 'Игры, видео · 60 к/с' },
              ]}
            />
          </div>
        </Card>

        <div class="ui-kit-stack">
          <Card padding="md">
            <h2>Chip</h2>
            <div class="ui-kit-row">
              <Chip tone="accent" dot>
                Идёт · 2 человека
              </Chip>
              <Chip dot>Не запущена</Chip>
              <Chip>Организатор не в сети</Chip>
              <Chip mono>12:48</Chip>
              <Chip tone="accent">24 мс · через организатора</Chip>
              <Chip tone="danger">микрофон выкл.</Chip>
              <Chip size="sm">организатор</Chip>
              <Chip tone="overlay" mono>
                1080p · 30 к/с · 2,8 Мбит/с
              </Chip>
            </div>
          </Card>
          <Card padding="md">
            <h2>Avatar</h2>
            <div class="ui-kit-row">
              <Avatar name="Дима" size="xs" />
              <Avatar name="Катя" size="sm" />
              <Avatar name="Миша" size="md" speaking />
              <Avatar name="Алексей" size="lg" />
              <Avatar name="Оля" size="xl" decorative={false} />
            </div>
          </Card>
          <Card padding="md" inset>
            <h2>Card inset</h2>
            <p class="ui-kit-muted">Вложенная панель, как проверка микрофона на экране входа.</p>
          </Card>
        </div>
      </section>
    </main>
  )
}
