import { useMemo } from 'react'
import type { GeoEvent } from '../services/dataService'

interface Props {
  events: GeoEvent[]
  start: number
  end: number
  /** null = ao vivo (mostra tudo) */
  cursor: number | null
  playing: boolean
  onCursor: (t: number | null) => void
  onPlay: (p: boolean) => void
}

const HOURS = 24
const fmtHour = (t: number) => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

/** Linha do tempo das últimas 24 h: histograma por hora + controle de replay. */
export function Timeline({ events, start, end, cursor, playing, onCursor, onPlay }: Props) {
  const bins = useMemo(() => {
    const b = Array.from({ length: HOURS }, () => ({ n: 0, max: 0 }))
    const span = end - start
    for (const e of events) {
      const i = Math.min(HOURS - 1, Math.max(0, Math.floor(((e.time - start) / span) * HOURS)))
      b[i].n++
      b[i].max = Math.max(b[i].max, e.magnitude ?? 0)
    }
    return b
  }, [events, start, end])
  const peak = Math.max(1, ...bins.map((b) => b.n))
  const value = cursor ?? end
  const pct = ((value - start) / (end - start)) * 100
  const live = cursor === null

  return (
    <div className="hud-panel pointer-events-auto px-3 py-2">
      <div className="flex items-center gap-3">
        <button
          onClick={() => onPlay(!playing)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-white/15 text-gold hover:border-ember/60 focus-visible:ring-1 focus-visible:ring-ember"
          aria-label={playing ? 'Pausar replay' : 'Reproduzir as últimas 24 horas'}
        >
          {playing ? (
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor"><rect x="6" y="5" width="4" height="14" /><rect x="14" y="5" width="4" height="14" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor"><path d="M7 5v14l12-7z" /></svg>
          )}
        </button>
        <div className="relative min-w-0 flex-1">
          {/* histograma */}
          <div className="flex h-7 items-end gap-[2px]" aria-hidden>
            {bins.map((b, i) => {
              const binEnd = start + ((i + 1) / HOURS) * (end - start)
              const past = binEnd <= value + (end - start) / HOURS
              return (
                <span
                  key={i}
                  className="flex-1 rounded-t-[1px] transition-opacity"
                  style={{
                    height: `${Math.max(6, (b.n / peak) * 100)}%`,
                    background: b.max >= 5 ? '#ff5a2a' : b.max >= 4 ? '#ff9a3a' : '#ffd27a',
                    opacity: b.n ? (past ? 0.85 : 0.18) : 0.08,
                  }}
                />
              )
            })}
          </div>
          <input
            type="range"
            min={start}
            max={end}
            step={60_000}
            value={value}
            onChange={(e) => {
              const v = Number(e.target.value)
              onPlay(false)
              onCursor(v >= end - 60_000 ? null : v)
            }}
            onKeyDown={(e) => e.stopPropagation()}
            aria-label="Momento exibido na linha do tempo"
            aria-valuetext={live ? 'Ao vivo' : fmtHour(value)}
            className="timeline-range absolute inset-x-0 -bottom-1 h-9 w-full cursor-pointer opacity-0"
          />
          <span className="pointer-events-none absolute -bottom-1 h-1 w-px bg-white" style={{ left: `${pct}%` }} />
          <div className="mt-1 h-px w-full bg-white/10">
            <div className="h-px bg-gradient-to-r from-ember via-gold to-plasma" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="w-[74px] shrink-0 text-right">
          {live ? (
            <button onClick={() => onCursor(start)} className="text-[10px] uppercase tracking-[0.16em] text-emerald-300 hover:text-white" title="Voltar ao início">
              ● Ao vivo
            </button>
          ) : (
            <button onClick={() => { onPlay(false); onCursor(null) }} className="text-[11px] tabular-nums text-gold hover:text-white" title="Voltar ao vivo">
              {fmtHour(value)}
            </button>
          )}
        </div>
      </div>
      <div className="mt-1 flex justify-between pl-12 pr-[86px] text-[9px] text-white/30">
        <span>{fmtHour(start)}</span>
        <span>Últimas 24 h · eventos por hora</span>
        <span>{fmtHour(end)}</span>
      </div>
    </div>
  )
}
