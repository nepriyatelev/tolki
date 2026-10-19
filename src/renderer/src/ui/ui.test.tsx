import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import Mic from 'lucide-solid/icons/mic'
import Plus from 'lucide-solid/icons/plus'
import { createSignal } from 'solid-js'
import { describe, expect, it, vi } from 'vitest'
import { Avatar, avatarColorIndex, avatarInitial } from './Avatar'
import { Button, IconButton } from './Button'
import { Card } from './Card'
import { Checkbox } from './Checkbox'
import { Tooltip, TOOLTIP_DELAY_MS } from './Tooltip'
import { Chip } from './Chip'
import { Input } from './Input'
import { RadioPillGroup } from './RadioPillGroup'

describe('Button', () => {
  it('is a plain button by default and keeps icons out of the accessible name', () => {
    render(() => <Button icon={<Plus />}>Создать комнату</Button>)
    const button = screen.getByRole('button', { name: 'Создать комнату' })

    expect(button.getAttribute('type')).toBe('button')
    expect(button.className).toContain('rt-button--secondary')
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('is reachable with Tab and activated with Enter and Space', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(() => (
      <Button variant="primary" onClick={onClick}>
        Войти
      </Button>
    ))

    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Войти' }))
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(onClick).toHaveBeenCalledTimes(2)
  })

  it('cannot be activated when disabled', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(() => (
      <Button disabled onClick={onClick}>
        Войти
      </Button>
    ))

    await user.tab()
    expect(document.activeElement).toBe(document.body)
    await user.click(screen.getByRole('button', { name: 'Войти' }))
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe('IconButton', () => {
  it('gets its accessible name from the label', () => {
    render(() => <IconButton label="Настройки" icon={<Plus />} />)
    const button = screen.getByRole('button', { name: 'Настройки' })

    expect(button.getAttribute('title')).toBe('Настройки')
    expect(button.getAttribute('aria-pressed')).toBeNull()
  })

  it('exposes toggle state as aria-pressed and toggles from the keyboard', async () => {
    const user = userEvent.setup()
    render(() => {
      const [muted, setMuted] = createSignal(false)
      return (
        <IconButton
          label="Микрофон"
          icon={<Mic />}
          pressed={muted()}
          onClick={() => setMuted((m) => !m)}
        />
      )
    })
    const button = screen.getByRole('button', { name: 'Микрофон' })
    expect(button.getAttribute('aria-pressed')).toBe('false')

    await user.tab()
    await user.keyboard(' ')
    expect(button.getAttribute('aria-pressed')).toBe('true')
  })
})

describe('Input', () => {
  it('is labelled and described by its hint', () => {
    render(() => <Input label="Пароль" hint="Пустой пароль — вход без пароля" />)
    const input = screen.getByRole('textbox', { name: 'Пароль' })

    expect(input.getAttribute('aria-invalid')).toBeNull()
    const describedBy = input.getAttribute('aria-describedby') ?? ''
    expect(document.getElementById(describedBy)?.textContent).toBe(
      'Пустой пароль — вход без пароля',
    )
  })

  it('shows the error instead of the hint and marks the field invalid', () => {
    render(() => <Input label="Порт" hint="1024–65535" error="Неверный порт" />)
    const input = screen.getByRole('textbox', { name: 'Порт' })

    expect(input.getAttribute('aria-invalid')).toBe('true')
    const describedBy = input.getAttribute('aria-describedby') ?? ''
    expect(document.getElementById(describedBy)?.textContent).toBe('Неверный порт')
    expect(screen.queryByText('1024–65535')).toBeNull()
  })

  it('accepts typing after Tab focus', async () => {
    const user = userEvent.setup()
    render(() => <Input label="Имя" />)

    await user.tab()
    await user.keyboard('Алексей')
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Имя' }).value).toBe('Алексей')
  })
})

describe('Checkbox', () => {
  it('is a labelled native checkbox toggled with Space and by clicking the label', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(() => (
      <Checkbox label="Вшить пароль в ссылку" description="Удобнее" onChange={onChange} />
    ))
    const checkbox = screen.getByRole<HTMLInputElement>('checkbox', {
      name: 'Вшить пароль в ссылку',
    })
    expect(checkbox.getAttribute('aria-describedby')).toBeTruthy()

    await user.tab()
    expect(document.activeElement).toBe(checkbox)
    await user.keyboard(' ')
    expect(checkbox.checked).toBe(true)

    await user.click(screen.getByText('Вшить пароль в ссылку'))
    expect(checkbox.checked).toBe(false)
    expect(onChange).toHaveBeenCalledTimes(2)
  })
})

describe('RadioPillGroup', () => {
  const options = [
    { value: 'auto', label: 'Авто', description: 'Подстраивается под сеть' },
    { value: 'text', label: 'Чёткий текст' },
    { value: 'motion', label: 'Плавно' },
  ] as const

  function renderGroup(compact = false) {
    const onChange = vi.fn()
    render(() => {
      const [value, setValue] = createSignal<'auto' | 'text' | 'motion'>('auto')
      return (
        <RadioPillGroup
          legend="Демонстрация экрана"
          options={options}
          compact={compact}
          value={value()}
          onChange={(v) => {
            setValue(v)
            onChange(v)
          }}
        />
      )
    })
    return onChange
  }

  it('is a named group of radios with the current value checked', () => {
    renderGroup()

    expect(screen.getByRole('group', { name: 'Демонстрация экрана' })).toBeTruthy()
    const radios = screen.getAllByRole<HTMLInputElement>('radio')
    expect(radios.map((r) => r.checked)).toEqual([true, false, false])
    expect(new Set(radios.map((r) => r.name)).size).toBe(1)
  })

  it('compact: one line of labels, the chosen description under it (#110)', async () => {
    const user = userEvent.setup()
    renderGroup(true)

    expect(document.querySelector('.rt-radio-pills__hint')?.textContent).toBe(
      'Подстраивается под сеть',
    )
    // Still read with its option.
    expect(screen.getByRole('radio', { name: /Подстраивается под сеть/ })).toBeTruthy()

    await user.click(screen.getByRole('radio', { name: /Плавно/ }))
    expect(document.querySelector('.rt-radio-pills__hint')).toBeNull()
  })

  it('changes selection by click and with arrow keys', async () => {
    const user = userEvent.setup()
    const onChange = renderGroup()

    await user.click(screen.getByRole('radio', { name: /Плавно/ }))
    expect(onChange).toHaveBeenLastCalledWith('motion')

    await user.keyboard('{ArrowUp}')
    expect(onChange).toHaveBeenLastCalledWith('text')
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /Чёткий текст/ }).checked).toBe(true)
  })
})

describe('Card', () => {
  it('renders the requested element with content', () => {
    render(() => (
      <Card as="section" aria-label="Проверка сети">
        Порт открыт
      </Card>
    ))
    const card = screen.getByRole('region', { name: 'Проверка сети' })

    expect(card.tagName).toBe('SECTION')
    expect(card.textContent).toBe('Порт открыт')
  })
})

describe('Chip', () => {
  it('renders text with a decorative status dot', () => {
    render(() => (
      <Chip tone="accent" dot>
        Идёт · 2 человека
      </Chip>
    ))
    const chip = screen.getByText('Идёт · 2 человека')

    expect(chip.className).toContain('rt-chip--accent')
    expect(chip.querySelector('.rt-chip__dot')?.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('Avatar', () => {
  it('shows the uppercase initial and is hidden from assistive tech by default', () => {
    const { container } = render(() => <Avatar name="дима" />)
    const avatar = container.firstElementChild

    expect(avatar?.textContent).toBe('Д')
    expect(avatar?.getAttribute('aria-hidden')).toBe('true')
  })

  it('is an image labelled with the name when not decorative', () => {
    render(() => <Avatar name="Катя" decorative={false} />)

    expect(screen.getByRole('img', { name: 'Катя' }).textContent).toBe('К')
  })

  it('picks a stable colour per name', () => {
    expect(avatarColorIndex('Миша')).toBe(avatarColorIndex(' миша '))
    expect(avatarColorIndex('Миша')).toBeGreaterThanOrEqual(1)
    expect(avatarColorIndex('Миша')).toBeLessThanOrEqual(6)
  })

  it('handles empty names and emoji', () => {
    expect(avatarInitial('   ')).toBe('?')
    expect(avatarInitial('🐿️ Толки')).toBe('🐿')
  })
})

describe('Tooltip (#110)', () => {
  it('shows after a short hover, describes the control, and hides on leave', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
      render(() => (
        <Tooltip text="Выключить микрофон · Ctrl+Shift+M">
          {(id) => (
            <button type="button" aria-describedby={id}>
              Микрофон
            </button>
          )}
        </Tooltip>
      ))
      const button = screen.getByRole('button', { name: 'Микрофон' })
      await user.hover(button)
      expect(screen.queryByRole('tooltip')).toBeNull()
      await vi.advanceTimersByTimeAsync(TOOLTIP_DELAY_MS)
      const tip = screen.getByRole('tooltip')
      expect(tip.textContent).toBe('Выключить микрофон · Ctrl+Shift+M')
      expect(button.getAttribute('aria-describedby')).toBe(tip.id)
      await user.unhover(button)
      expect(screen.queryByRole('tooltip')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('right after one tooltip, the next one comes at once', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
      render(() => (
        <>
          <Tooltip text="Микрофон · Ctrl+Shift+M">
            {() => <button type="button">Микрофон</button>}
          </Tooltip>
          <Tooltip text="Звук · Ctrl+Shift+D">{() => <button type="button">Звук</button>}</Tooltip>
        </>
      ))
      await user.hover(screen.getByRole('button', { name: 'Микрофон' }))
      await vi.advanceTimersByTimeAsync(TOOLTIP_DELAY_MS)
      await user.unhover(screen.getByRole('button', { name: 'Микрофон' }))
      await user.hover(screen.getByRole('button', { name: 'Звук' }))
      await vi.advanceTimersByTimeAsync(1)
      expect(screen.getByRole('tooltip').textContent).toBe('Звук · Ctrl+Shift+D')
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows at once on keyboard focus and hides on Esc', async () => {
    const user = userEvent.setup()
    render(() => (
      <Tooltip text="Звук · Ctrl+Shift+D">{() => <button type="button">Звук</button>}</Tooltip>
    ))
    await user.tab()
    expect(await screen.findByRole('tooltip')).toBeTruthy()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})
