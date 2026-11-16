import { useEffect, useRef, useState } from 'react'
import { searchLocal, searchOnline, type Place } from '../services/geocodeService'

interface Props {
  onSelect: (p: Place) => void
  onClear: () => void
}

/** Busca de lugares: sugestões locais na hora + OpenStreetMap com debounce. */
export function SearchBar({ onSelect, onClear }: Props) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [local, setLocal] = useState<Place[]>([])
  const [online, setOnline] = useState<Place[]>([])
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'done'>('idle')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  // atalho "/" ou Ctrl+K foca a busca
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === '/' || (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey))) && document.activeElement !== inputRef.current) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const onDown = (e: PointerEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [])

  useEffect(() => {
    setLocal(searchLocal(q))
    setActive(0)
    if (q.trim().length < 3) { setOnline([]); setState('idle'); return }
    const ctrl = new AbortController()
    setState('loading')
    const id = setTimeout(() => {
      searchOnline(q.trim(), ctrl.signal)
        .then((r) => { setOnline(r); setState('done') })
        .catch((e) => { if (e.name !== 'AbortError') { setOnline([]); setState('error') } })
    }, 650)
    return () => { clearTimeout(id); ctrl.abort() }
  }, [q])

  // evita repetir o mesmo lugar nas duas listas
  const localNames = new Set(local.map((p) => p.name.toLowerCase()))
  const results = [...local, ...online.filter((p) => !localNames.has(p.name.toLowerCase()))].slice(0, 8)

  const choose = (p: Place) => {
    onSelect(p)
    setQ(p.name)
    setOpen(false)
    inputRef.current?.blur()
  }

  return (
    <div ref={boxRef} className="pointer-events-auto relative w-full">
      <div className="hud-panel flex items-center gap-2 px-3 focus-within:border-ember/60">
        <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-white/45" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
        </svg>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
            else if (e.key === 'Enter' && results[active]) choose(results[active])
            else if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur() }
            e.stopPropagation() // não dispara os atalhos do globo enquanto digita
          }}
          placeholder="Buscar lugar…"
          aria-label="Buscar lugar no globo"
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls="search-results"
          className="min-h-11 w-full bg-transparent text-[16px] text-white placeholder:text-white/35 outline-none sm:text-[12px] tracking-[0.06em]"
        />
        {state === 'loading' && <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-gold" aria-label="buscando" />}
        {q && (
          <button onClick={() => { setQ(''); onClear(); inputRef.current?.focus() }} className="min-h-8 min-w-8 text-white/45 hover:text-white" aria-label="Limpar busca">×</button>
        )}
        <kbd className="hidden text-[10px] text-white/25 sm:block">/</kbd>
      </div>

      {open && q.trim().length >= 2 && (
        <div id="search-results" role="listbox" className="hud-panel absolute left-0 right-0 top-[calc(100%+6px)] overflow-hidden">
          {results.length === 0 && (
            <p className="px-3 py-3 text-[11px] text-white/45">
              {state === 'loading' ? 'Procurando…' : state === 'error' ? 'Busca online indisponível. Tente o nome de um país ou cidade.' : 'Nenhum lugar encontrado.'}
            </p>
          )}
          {results.map((p, i) => (
            <button
              key={p.id}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(p)}
              className={`flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left ${i === active ? 'bg-white/[0.07]' : ''}`}
            >
              <span className="min-w-0">
                <span className="block truncate text-[12px] text-white">{p.name}</span>
                <span className="block truncate text-[10px] text-white/40">{p.detail}</span>
              </span>
              <span className="shrink-0 text-[10px] tabular-nums text-white/30">
                {p.lat.toFixed(1)}°, {p.lon.toFixed(1)}°
              </span>
            </button>
          ))}
          <p className="border-t border-white/10 px-3 py-1.5 text-[9px] text-white/30">
            Locais: Natural Earth · busca mundial: © OpenStreetMap
          </p>
        </div>
      )}
    </div>
  )
}
