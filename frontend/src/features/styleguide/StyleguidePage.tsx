import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/design/components/Button'
import { IconButton } from '@/design/components/IconButton'
import { ThemeToggle } from '@/design/components/ThemeToggle'
import { Tooltip } from '@/design/components/Tooltip'
import { Switch } from '@/design/components/Switch'
import { Tabs } from '@/design/components/Tabs'
import { Dialog } from '@/design/components/Dialog'
import { DropdownMenu } from '@/design/components/DropdownMenu'

const colorTokens = [
  ['bg', 'Background'],
  ['surface', 'Surface'],
  ['surface-raised', 'Surface raised'],
  ['border', 'Border'],
  ['text', 'Text'],
  ['text-muted', 'Text muted'],
  ['accent', 'Accent'],
  ['danger', 'Danger'],
] as const

const priorityTokens = [
  ['priority-low', 'Low'],
  ['priority-medium', 'Medium'],
  ['priority-high', 'High'],
] as const

const paletteTokens = [
  'palette-1',
  'palette-2',
  'palette-3',
  'palette-4',
  'palette-5',
  'palette-6',
  'palette-7',
  'palette-8',
  'palette-9',
  'palette-10',
  'palette-11',
  'palette-12',
]

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-border py-8 first:pt-0 last:border-b-0">
      <h2 className="mb-4 font-serif text-xl">{title}</h2>
      {children}
    </section>
  )
}

function Swatch({ token, label }: { token: string; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-10 w-10 shrink-0 rounded-md border border-border"
        style={{ background: `var(--${token})` }}
      />
      <div>
        <div className="text-sm">{label}</div>
        <div className="text-xs text-text-muted">--{token}</div>
      </div>
    </div>
  )
}

export default function StyleguidePage() {
  const [switchOn, setSwitchOn] = useState(true)

  return (
    <div className="mx-auto max-w-[72ch] px-6 py-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="font-serif text-2xl">Styleguide</h1>
          <p className="text-sm text-text-muted">Design tokens and base components — dev only.</p>
        </div>
        <ThemeToggle />
      </header>

      <Section title="Color">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {colorTokens.map(([token, label]) => (
            <Swatch key={token} token={token} label={label} />
          ))}
        </div>
      </Section>

      <Section title="Priority & list colors">
        <div className="mb-4 flex gap-4">
          {priorityTokens.map(([token, label]) => (
            <Swatch key={token} token={token} label={label} />
          ))}
        </div>
        <div className="flex gap-2">
          {paletteTokens.map((token) => (
            <div
              key={token}
              className="h-8 w-8 rounded-full border border-border"
              style={{ background: `var(--${token})` }}
              title={token}
            />
          ))}
        </div>
      </Section>

      <Section title="Typography">
        <h1 className="font-serif text-3xl">Heading serif 3xl</h1>
        <h2 className="mt-2 font-serif text-2xl">Heading serif 2xl</h2>
        <h3 className="mt-2 font-serif text-xl">Heading serif xl</h3>
        <p className="mt-4 text-base">
          Body text uses a humanist sans-serif at 1.6 line height. The quick brown fox jumps over
          the lazy dog. Быстрая коричневая лиса перепрыгивает через ленивую собаку.
        </p>
        <p className="mt-2 text-sm text-text-muted">Muted text for secondary information.</p>
        <code className="mt-4 block rounded-md bg-surface px-3 py-2 font-mono text-sm">
          const nook = &quot;self-hosted&quot;;
        </code>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <Tooltip label="Add item">
            <IconButton label="Add">
              <Plus size={16} strokeWidth={1.5} />
            </IconButton>
          </Tooltip>
          <Tooltip label="Delete item">
            <IconButton label="Delete">
              <Trash2 size={16} strokeWidth={1.5} />
            </IconButton>
          </Tooltip>
        </div>
      </Section>

      <Section title="Controls">
        <div className="flex items-center gap-3">
          <Switch checked={switchOn} onCheckedChange={setSwitchOn} label="Notifications" />
          <span className="text-sm text-text-muted">Notifications {switchOn ? 'on' : 'off'}</span>
        </div>
      </Section>

      <Section title="Tabs">
        <Tabs
          items={[
            {
              value: 'a',
              label: 'List',
              content: <p className="text-sm text-text-muted">List view content.</p>,
            },
            {
              value: 'b',
              label: 'Calendar',
              content: <p className="text-sm text-text-muted">Calendar view content.</p>,
            },
          ]}
        />
      </Section>

      <Section title="Overlays">
        <div className="flex gap-3">
          <Dialog
            trigger={<Button variant="secondary">Open dialog</Button>}
            title="Delete list"
            description="Tasks in this list will move to Inbox."
          >
            <div className="flex justify-end gap-2">
              <Button variant="ghost">Cancel</Button>
              <Button variant="danger">Delete</Button>
            </div>
          </Dialog>
          <DropdownMenu
            trigger={<Button variant="secondary">Open menu</Button>}
            items={[{ label: 'Rename' }, { label: 'Duplicate' }, { label: 'Delete', danger: true }]}
          />
        </div>
      </Section>
    </div>
  )
}
