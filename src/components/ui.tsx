import type { ReactNode } from 'react'

export function Panel({ title, children, className = '', right }: { title?: string; children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    <section className={`hud-panel pointer-events-auto ${className}`}>
      {title && (
        <header className="flex items-center justify-between border-b border-white/10 px-3 py-2">
          <h2 className="hud-title">{title}</h2>
          {right}
        </header>
      )}
      <div className="px-3 py-2.5">{children}</div>
    </section>
  )
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex min-h-9 w-full items-center justify-between gap-4 rounded px-1 text-left text-[11px] uppercase tracking-[0.14em] text-white/70 outline-none hover:text-white focus-visible:ring-1 focus-visible:ring-ember"
    >
      <span>
        {label}
        {hint && <kbd className="ml-2 text-[9px] text-white/30">{hint}</kbd>}
      </span>
      <span className={`relative h-4 w-8 shrink-0 rounded-full border transition-colors ${checked ? 'border-ember/70 bg-ember/30' : 'border-white/20 bg-white/5'}`}>
        <span className={`absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full transition-all ${checked ? 'left-[18px] bg-gold shadow-[0_0_8px_#ff8a2a]' : 'left-[3px] bg-white/40'}`} />
      </span>
    </button>
  )
}

export function Stat({ label, value, accent }: { label: string; value: ReactNode; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-0.5 text-[11px]">
      <span className="uppercase tracking-[0.12em] text-white/45">{label}</span>
      <span className={`tabular-nums ${accent ? 'text-gold' : 'text-white/90'}`}>{value}</span>
    </div>
  )
}
