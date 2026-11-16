import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GlobeScene, type SceneStats } from './scene/GlobeScene'
import {
  fetchEarthquakes, initialTraffic, makeTrafficArc,
  type DataMode, type GeoEvent, type Snapshot,
} from './services/dataService'
import { Panel, Stat, Toggle } from './components/ui'

const QUAKE_REFRESH_MS = 60_000
const TRAFFIC_TICK_MS = 1400
const TOUR_MS = 7000

const fmtAgo = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000)
  if (m < 1) return 'agora'
  if (m < 60) return `há ${m} min`
  const h = Math.floor(m / 60)
  return `há ${h} h ${m % 60} min`
}
const fmtInt = (n: number) => n.toLocaleString('pt-BR')

const STATUS = {
  conectando: { text: 'CONECTANDO', color: 'bg-white/60' },
  'ao-vivo': { text: 'AO VIVO · USGS', color: 'bg-emerald-400' },
  offline: { text: 'OFFLINE · DEMO', color: 'bg-amber-400' },
  simulado: { text: 'SIMULADO', color: 'bg-sky-400' },
} as const

export default function App() {
  const mountRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<GlobeScene | null>(null)
  const [mode, setMode] = useState<DataMode>('sismico')
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [feedOpen, setFeedOpen] = useState(() => window.innerWidth > 900)
  const [rings, setRings] = useState(true)
  const [flares, setFlares] = useState(true)
  const [tour, setTour] = useState(false)
  const [guiOpen, setGuiOpen] = useState(false)
  const [hudVisible, setHudVisible] = useState(true)
  const [stats, setStats] = useState<SceneStats>({ fps: 0, particles: 0, arcs: 0, landDots: 0 })
  const [, setNow] = useState(0)

  // cena 3D
  useEffect(() => {
    const scene = new GlobeScene(mountRef.current!)
    scene.onStats = setStats
    sceneRef.current = scene
    ;(window as unknown as { globe: GlobeScene }).globe = scene // útil para depurar no console
    return () => { scene.dispose(); sceneRef.current = null }
  }, [])

  // fonte de dados
  useEffect(() => {
    setSelected(null)
    if (mode === 'sismico') {
      const ctrl = new AbortController()
      setSnap((s) => (s ? { ...s, status: 'conectando' } : null))
      const load = () => fetchEarthquakes(ctrl.signal).then(setSnap).catch(() => {})
      load()
      const id = setInterval(load, QUAKE_REFRESH_MS)
      return () => { ctrl.abort(); clearInterval(id) }
    }
    setSnap(initialTraffic())
    const id = setInterval(() => {
      setSnap((s) => {
        if (!s) return s
        const { arc, event } = makeTrafficArc()
        return { ...s, arcs: [arc, ...s.arcs].slice(0, 34), events: [event, ...s.events].slice(0, 60), fetchedAt: Date.now() }
      })
    }, TRAFFIC_TICK_MS)
    return () => clearInterval(id)
  }, [mode])

  // envia dados para a cena
  useEffect(() => {
    if (!snap || !sceneRef.current) return
    sceneRef.current.setEvents(snap.events)
    sceneRef.current.setArcs(snap.arcs)
  }, [snap])

  useEffect(() => { sceneRef.current?.setSelected(selected) }, [selected])
  useEffect(() => { sceneRef.current?.setRingsVisible(rings) }, [rings])
  useEffect(() => { sceneRef.current?.setFlares(flares) }, [flares])
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id) }, [])

  const focus = useCallback((e: GeoEvent) => {
    setSelected(e.id)
    sceneRef.current?.flyTo(e.lat, e.lon)
  }, [])

  // tour automático pelos eventos mais intensos (bom para apresentação)
  useEffect(() => {
    if (!tour || !snap) return
    const top = [...snap.events].sort((a, b) => b.intensity - a.intensity).slice(0, 8)
    if (!top.length) return
    let i = 0
    focus(top[0])
    const id = setInterval(() => { i = (i + 1) % top.length; focus(top[i]) }, TOUR_MS)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour, mode, snap?.source])

  // atalhos de teclado
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.target instanceof HTMLElement && ev.target.closest('input, textarea, .lil-gui')) return
      const k = ev.key.toLowerCase()
      if (k === 'g') setGuiOpen(sceneRef.current?.toggleGui() ?? false)
      else if (k === 'f') setFeedOpen((v) => !v)
      else if (k === 't') setTour((v) => !v)
      else if (k === 'm') setMode((m) => (m === 'sismico' ? 'trafego' : 'sismico'))
      else if (k === 'h') setHudVisible((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const summary = useMemo(() => {
    const ev = snap?.events ?? []
    if (mode === 'sismico') {
      const strongest = ev.reduce<GeoEvent | null>((m, e) => (!m || (e.magnitude ?? 0) > (m.magnitude ?? 0) ? e : m), null)
      const avgMag = ev.length ? ev.reduce((s, e) => s + (e.magnitude ?? 0), 0) / ev.length : 0
      const avgDepth = ev.length ? ev.reduce((s, e) => s + (e.depthKm ?? 0), 0) / ev.length : 0
      return { strongest, avgMag, avgDepth }
    }
    const gbps = ev.slice(0, 34).reduce((s, e) => s + parseFloat(e.label), 0)
    const hubs = new Map<string, number>()
    ev.forEach((e) => { const h = e.detail.split(' → ')[0]; hubs.set(h, (hubs.get(h) ?? 0) + 1) })
    const topHub = [...hubs.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'
    return { gbps, topHub }
  }, [snap, mode])

  const status = STATUS[snap?.status ?? 'conectando']
  const events = snap?.events ?? []

  return (
    <div className="relative h-full w-full select-none bg-black font-mono">
      <div ref={mountRef} className="absolute inset-0" aria-label="Globo 3D interativo. Arraste para girar, role para aproximar." role="img" />

      <div className={`pointer-events-none absolute inset-0 transition-opacity duration-500 ${hudVisible ? 'opacity-100' : 'opacity-0'}`}>
        {/* superior esquerdo: identificação + status */}
        <Panel className="absolute left-4 top-4 w-[min(290px,calc(100vw-8rem))]">
          <div className="flex items-center justify-between">
            <h1 className="text-[13px] font-semibold tracking-[0.22em] text-white">ORBITAL<span className="text-ember">//</span>SYS-01</h1>
            <span className="text-[10px] text-white/35">v1.0</span>
          </div>
          <div className="mt-2 flex items-center gap-2 text-[11px] tracking-[0.14em]">
            <span className={`pulse-dot h-2 w-2 rounded-full ${status.color} shadow-[0_0_10px_currentColor]`} />
            <span className="text-white/80">{status.text}</span>
          </div>
          <div className="mt-2 border-t border-white/10 pt-2">
            <Stat label="FPS" value={stats.fps.toFixed(0)} />
            <Stat label="Partículas" value={fmtInt(stats.particles)} />
            <Stat label="Fluxos ativos" value={stats.arcs} />
            <Stat label="Pontos de terra" value={fmtInt(stats.landDots)} />
          </div>
        </Panel>

        {/* inferior esquerdo: estatísticas */}
        <Panel title={mode === 'sismico' ? 'Atividade sísmica · 24 h' : 'Tráfego global · simulado'} className="absolute bottom-4 left-4 w-[min(320px,calc(100vw-2rem))]">
          {mode === 'sismico' ? (
            <>
              <Stat label="Eventos recentes (M2.5+)" value={events.length} accent />
              <Stat label="Maior magnitude" value={summary.strongest ? `M ${summary.strongest.magnitude?.toFixed(1)}` : '—'} accent />
              <p className="truncate pb-1 text-right text-[10px] text-white/40">{summary.strongest?.detail ?? ''}</p>
              <Stat label="Magnitude média" value={summary.avgMag?.toFixed(2) ?? '—'} />
              <Stat label="Profundidade média" value={`${summary.avgDepth?.toFixed(0) ?? '—'} km`} />
            </>
          ) : (
            <>
              <Stat label="Fluxos de dados" value={stats.arcs} accent />
              <Stat label="Vazão agregada" value={`${(summary.gbps ?? 0).toFixed(0)} Gb/s`} accent />
              <Stat label="Hub mais ativo" value={summary.topHub} />
              <Stat label="Conexões no feed" value={events.length} />
            </>
          )}
          <p className="mt-2 border-t border-white/10 pt-2 text-[10px] text-white/35">
            {snap?.source ?? '…'} · atualizado {snap ? fmtAgo(snap.fetchedAt) : '—'}
          </p>
        </Panel>

        {/* lateral direita: feed retrátil */}
        <aside
          className={`absolute right-4 top-4 flex max-h-[calc(100%-15rem)] w-[min(340px,calc(100vw-2rem))] flex-col transition-transform duration-500 ease-out ${feedOpen ? 'translate-x-0' : 'translate-x-[calc(100%+1.5rem)]'}`}
          aria-hidden={!feedOpen}
        >
          <Panel
            title={`Event feed · ${events.length}`}
            className="flex min-h-0 flex-col"
            right={<button className="min-h-8 min-w-8 text-white/50 hover:text-white focus-visible:ring-1 focus-visible:ring-ember" onClick={() => setFeedOpen(false)} aria-label="Recolher feed">×</button>}
          >
            <ul className="scrollbar-thin -mx-3 max-h-[60vh] overflow-y-auto">
              {events.length === 0 && <li className="px-3 py-6 text-center text-[11px] text-white/40">Aguardando dados…</li>}
              {events.map((e) => (
                <li key={e.id}>
                  <button
                    onClick={() => focus(e)}
                    className={`group flex w-full items-start gap-3 border-l-2 px-3 py-2 text-left outline-none transition-colors hover:bg-white/5 focus-visible:bg-white/5 ${selected === e.id ? 'border-ember bg-white/[0.06]' : 'border-transparent'}`}
                  >
                    <span
                      className="mt-1 h-2 w-2 shrink-0 rounded-full"
                      style={{ background: `hsl(${40 - e.intensity * 40} 100% ${75 - e.intensity * 20}%)`, boxShadow: `0 0 ${4 + e.intensity * 10}px hsl(${30 - e.intensity * 30} 100% 55%)` }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex justify-between gap-2 text-[11px]">
                        <span className="text-gold tabular-nums">{e.label}</span>
                        <span className="text-white/35">{fmtAgo(e.time)}</span>
                      </span>
                      <span className="block truncate text-[11px] text-white/70 group-hover:text-white">{e.detail}</span>
                      <span className="mt-1 block h-px bg-white/10">
                        <span className="block h-px bg-gradient-to-r from-ember via-gold to-plasma" style={{ width: `${Math.max(6, e.intensity * 100)}%` }} />
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
        </aside>
        {!feedOpen && (
          <button
            onClick={() => setFeedOpen(true)}
            className="hud-panel pointer-events-auto absolute right-4 top-4 min-h-11 px-3 text-[10px] uppercase tracking-[0.18em] text-white/70 hover:text-white focus-visible:ring-1 focus-visible:ring-ember"
          >
            Feed ‹ <kbd className="text-white/30">F</kbd>
          </button>
        )}

        {/* inferior direito: controles */}
        <Panel className="absolute bottom-4 right-4 w-[min(250px,calc(100vw-2rem))] max-[700px]:hidden">
          <div className="mb-2 grid grid-cols-2 gap-1 rounded border border-white/10 p-0.5" role="radiogroup" aria-label="Fonte de dados">
            {(['sismico', 'trafego'] as const).map((m) => (
              <button
                key={m}
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={`min-h-8 rounded text-[10px] uppercase tracking-[0.14em] outline-none focus-visible:ring-1 focus-visible:ring-ember ${mode === m ? 'bg-ember/25 text-gold' : 'text-white/50 hover:text-white'}`}
              >
                {m === 'sismico' ? 'Sísmico' : 'Tráfego'}
              </button>
            ))}
          </div>
          <Toggle label="Disco de acreção" checked={rings} onChange={setRings} />
          <Toggle label="Lens flare · calor" checked={flares} onChange={setFlares} />
          <Toggle label="Tour automático" checked={tour} onChange={setTour} hint="T" />
          <Toggle label="Calibração" checked={guiOpen} onChange={() => setGuiOpen(sceneRef.current?.toggleGui() ?? false)} hint="G" />
        </Panel>
      </div>

      {/* mobile: barra compacta de modo */}
      <div className="pointer-events-auto absolute bottom-[13.5rem] left-1/2 hidden -translate-x-1/2 max-[700px]:block">
        <button onClick={() => setMode((m) => (m === 'sismico' ? 'trafego' : 'sismico'))} className="hud-panel min-h-11 px-4 text-[11px] uppercase tracking-[0.16em] text-gold">
          Modo: {mode === 'sismico' ? 'Sísmico' : 'Tráfego'}
        </button>
      </div>
    </div>
  )
}
