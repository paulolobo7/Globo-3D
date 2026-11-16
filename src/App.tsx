import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GlobeScene, type SceneStats } from './scene/GlobeScene'
import {
  fetchEarthquakes, initialTraffic, makeTrafficArc,
  type DataMode, type GeoEvent, type Snapshot,
} from './services/dataService'
import type { Place } from './services/geocodeService'
import { haversineKm } from './utils/geo'
import { DEPTH_CLASSES, depthClass } from './utils/depth'
import { Panel, Stat, Toggle } from './components/ui'
import { SearchBar } from './components/SearchBar'
import { Timeline } from './components/Timeline'

const QUAKE_REFRESH_MS = 60_000
const TRAFFIC_TICK_MS = 1400
const TOUR_MS = 7000
const PRESENTATION_TOUR_MS = 9000
const DAY_MS = 24 * 3600_000
const REPLAY_SECONDS = 24 // 24 h de dados em 24 s
const NEARBY_KM = 500

const fmtAgo = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000)
  if (m < 1) return 'agora'
  if (m < 60) return `há ${m} min`
  const h = Math.floor(m / 60)
  return `há ${h} h ${m % 60} min`
}
const fmtInt = (n: number) => n.toLocaleString('pt-BR')
const fmtCoord = (lat: number, lon: number) =>
  `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? 'N' : 'S'} · ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? 'L' : 'O'}`

const STATUS = {
  conectando: { text: 'CONECTANDO', color: 'bg-white/60' },
  'ao-vivo': { text: 'AO VIVO · USGS', color: 'bg-emerald-400' },
  offline: { text: 'OFFLINE · DEMO', color: 'bg-amber-400' },
  simulado: { text: 'SIMULADO', color: 'bg-sky-400' },
} as const

interface Hover { e: GeoEvent; x: number; y: number }

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
  const [presentation, setPresentation] = useState(false)
  const [stats, setStats] = useState<SceneStats>({ fps: 0, particles: 0, arcs: 0, landDots: 0 })
  const [hover, setHover] = useState<Hover | null>(null)
  const [place, setPlace] = useState<Place | null>(null)
  const [caption, setCaption] = useState<GeoEvent | null>(null)
  const [cursor, setCursor] = useState<number | null>(null) // null = ao vivo
  const [playing, setPlaying] = useState(false)
  const [, setNow] = useState(0)

  // ------------------------------------------------------------ cena 3D
  useEffect(() => {
    const scene = new GlobeScene(mountRef.current!)
    scene.onStats = setStats
    scene.onHover = (e, x, y) => setHover(e ? { e, x, y } : null)
    sceneRef.current = scene
    ;(window as unknown as { globe: GlobeScene }).globe = scene // útil para depurar no console
    return () => { scene.dispose(); sceneRef.current = null }
  }, [])

  // ------------------------------------------------------------ fonte de dados
  useEffect(() => {
    setSelected(null)
    setCursor(null)
    setPlaying(false)
    sceneRef.current?.resetPinBirths()
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

  const events = useMemo(() => snap?.events ?? [], [snap])
  const timeEnd = snap?.fetchedAt ?? Date.now()
  const timeStart = timeEnd - DAY_MS

  // ------------------------------------------------------------ linha do tempo
  // eventos estão em ordem decrescente de tempo: conta quantos já "aconteceram" no cursor
  const visibleCount = useMemo(
    () => (cursor === null || mode !== 'sismico' ? events.length : events.filter((e) => e.time <= cursor).length),
    [events, cursor, mode],
  )
  const visibleEvents = useMemo(
    () => (visibleCount === events.length ? events : events.filter((e) => e.time <= (cursor ?? Infinity))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, visibleCount],
  )
  const visibleArcs = useMemo(() => {
    const arcs = snap?.arcs ?? []
    if (visibleCount === events.length) return arcs
    const ids = new Set(visibleEvents.map((e) => e.id))
    return arcs.filter((a) => !a.eventId || ids.has(a.eventId))
  }, [snap, visibleEvents, visibleCount, events.length])

  useEffect(() => {
    if (!sceneRef.current) return
    sceneRef.current.setEvents(visibleEvents)
    sceneRef.current.setArcs(visibleArcs)
  }, [visibleEvents, visibleArcs])

  // replay: avança o cursor 1 h por segundo
  useEffect(() => {
    if (!playing) return
    const stepMs = 100
    const advance = (DAY_MS / REPLAY_SECONDS) * (stepMs / 1000)
    const id = setInterval(() => {
      setCursor((c) => {
        const next = (c ?? timeStart) + advance
        if (next >= timeEnd) { setPlaying(false); return null }
        return next
      })
    }, stepMs)
    return () => clearInterval(id)
  }, [playing, timeStart, timeEnd])

  const play = useCallback((p: boolean) => {
    if (p) setCursor((c) => (c === null ? timeStart : c))
    setPlaying(p)
  }, [timeStart])

  useEffect(() => { sceneRef.current?.setSelected(selected) }, [selected])
  useEffect(() => { sceneRef.current?.setRingsVisible(rings) }, [rings])
  useEffect(() => { sceneRef.current?.setFlares(flares) }, [flares])
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id) }, [])

  // ------------------------------------------------------------ foco / tour
  const focus = useCallback((e: GeoEvent, cinematic = false) => {
    setSelected(e.id)
    setPlace(null)
    sceneRef.current?.beacon.hide()
    if (cinematic) {
      sceneRef.current?.flyTo(e.lat, e.lon, { distance: 2.55, duration: 3.2, hop: 1.1, hold: 6 })
      setCaption(e)
    } else {
      sceneRef.current?.flyTo(e.lat, e.lon)
    }
  }, [])

  useEffect(() => {
    sceneRef.current && (sceneRef.current.onPick = (e) => focus(e))
  }, [focus])

  const tourOn = tour || presentation
  useEffect(() => {
    if (!tourOn || !visibleEvents.length) return
    const top = [...visibleEvents].sort((a, b) => b.intensity - a.intensity).slice(0, 8)
    let i = 0
    focus(top[0], presentation)
    const id = setInterval(() => { i = (i + 1) % top.length; focus(top[i], presentation) }, presentation ? PRESENTATION_TOUR_MS : TOUR_MS)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourOn, presentation, mode, snap?.source])

  useEffect(() => { if (!presentation) setCaption(null) }, [presentation])

  // ------------------------------------------------------------ busca
  const goToPlace = useCallback((p: Place) => {
    setTour(false)
    setPresentation(false)
    setSelected(null)
    setPlace(p)
    sceneRef.current?.focusPlace(p.lat, p.lon, p.distance)
  }, [])
  const clearPlace = useCallback(() => {
    setPlace(null)
    sceneRef.current?.resetView()
  }, [])
  // o cartão do destino some junto com o farol
  useEffect(() => {
    if (!place) return
    const id = setTimeout(() => setPlace(null), 16_000)
    return () => clearTimeout(id)
  }, [place])

  const nearby = useMemo(() => {
    if (!place) return []
    return events
      .map((e) => ({ e, d: haversineKm(place.lat, place.lon, e.lat, e.lon) }))
      .filter((x) => x.d < NEARBY_KM)
      .sort((a, b) => a.d - b.d)
  }, [place, events])

  // ------------------------------------------------------------ atalhos de teclado
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.target instanceof HTMLElement && ev.target.closest('input, textarea, .lil-gui')) return
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return
      const k = ev.key.toLowerCase()
      if (k === 'g') setGuiOpen(sceneRef.current?.toggleGui() ?? false)
      else if (k === 'f') setFeedOpen((v) => !v)
      else if (k === 't') setTour((v) => !v)
      else if (k === 'm') setMode((m) => (m === 'sismico' ? 'trafego' : 'sismico'))
      else if (k === 'h') setHudVisible((v) => !v)
      else if (k === 'p') setPresentation((v) => !v)
      else if (k === 'escape') setPresentation(false)
      else if (k === ' ' && mode === 'sismico') { ev.preventDefault(); setPlaying((p) => { if (!p) setCursor((c) => c ?? timeStart); return !p }) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, timeStart])

  // ------------------------------------------------------------ resumo
  const summary = useMemo(() => {
    const ev = visibleEvents
    if (mode === 'sismico') {
      const strongest = ev.reduce<GeoEvent | null>((m, e) => (!m || (e.magnitude ?? 0) > (m.magnitude ?? 0) ? e : m), null)
      const avgMag = ev.length ? ev.reduce((s, e) => s + (e.magnitude ?? 0), 0) / ev.length : 0
      const avgDepth = ev.length ? ev.reduce((s, e) => s + (e.depthKm ?? 0), 0) / ev.length : 0
      const byDepth = DEPTH_CLASSES.map((c) => ev.filter((e) => depthClass(e.depthKm)?.id === c.id).length)
      return { strongest, avgMag, avgDepth, byDepth }
    }
    const gbps = ev.slice(0, 34).reduce((s, e) => s + parseFloat(e.label), 0)
    const hubs = new Map<string, number>()
    ev.forEach((e) => { const h = e.detail.split(' → ')[0]; hubs.set(h, (hubs.get(h) ?? 0) + 1) })
    const topHub = [...hubs.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'
    return { gbps, topHub }
  }, [visibleEvents, mode])

  const status = STATUS[snap?.status ?? 'conectando']
  const showHud = hudVisible && !presentation
  const hoverDepth = hover ? depthClass(hover.e.depthKm) : null

  return (
    <div className="relative h-full w-full select-none bg-black font-mono">
      <div ref={mountRef} className="absolute inset-0" aria-label="Globo 3D interativo. Arraste para girar, role para aproximar, clique num ponto para ver detalhes." role="img" />

      {/* faixas de cinema no modo apresentação */}
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-[7vh] bg-black transition-transform duration-700 ${presentation ? 'translate-y-0' : '-translate-y-full'}`} />
      <div className={`pointer-events-none absolute inset-x-0 bottom-0 h-[7vh] bg-black transition-transform duration-700 ${presentation ? 'translate-y-0' : 'translate-y-full'}`} />

      {/* tooltip do pin sob o cursor */}
      {hover && (
        <div
          className="hud-panel pointer-events-none fixed z-40 max-w-[260px] px-3 py-2"
          style={{ left: Math.min(hover.x + 16, window.innerWidth - 276), top: Math.min(hover.y + 16, window.innerHeight - 130) }}
          role="tooltip"
        >
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-[13px] font-semibold text-gold tabular-nums">{hover.e.label}</span>
            <span className="text-[10px] text-white/40">{fmtAgo(hover.e.time)}</span>
          </div>
          <p className="mt-0.5 text-[11px] leading-snug text-white/85">{hover.e.detail}</p>
          <div className="mt-1.5 space-y-0.5 border-t border-white/10 pt-1.5 text-[10px] text-white/50">
            {hover.e.depthKm != null && (
              <p className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: hoverDepth?.color }} />
                Profundidade {hover.e.depthKm.toFixed(0)} km · {hoverDepth?.label.toLowerCase()}
              </p>
            )}
            <p>{new Date(hover.e.time).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · {fmtCoord(hover.e.lat, hover.e.lon)}</p>
            <p className="text-white/30">clique para focar</p>
          </div>
        </div>
      )}

      {/* legenda cinematográfica (modo apresentação) */}
      {presentation && caption && (
        <div key={caption.id} className="caption-in pointer-events-none absolute bottom-[11vh] left-[6vw] max-w-[min(560px,88vw)]">
          <p className="text-[11px] uppercase tracking-[0.3em] text-ember">{mode === 'sismico' ? 'Evento sísmico' : 'Fluxo de dados'} · {fmtAgo(caption.time)}</p>
          <p className="mt-1 text-[clamp(28px,4vw,52px)] font-semibold leading-none text-white">{caption.label}</p>
          <p className="mt-2 text-[clamp(13px,1.3vw,17px)] text-white/75">{caption.detail}</p>
          <p className="mt-1 text-[11px] tabular-nums text-white/40">{fmtCoord(caption.lat, caption.lon)}{caption.depthKm != null && ` · ${caption.depthKm.toFixed(0)} km de profundidade`}</p>
        </div>
      )}
      {presentation && (
        <p className="hint-fade pointer-events-none absolute right-[4vw] top-[8.5vh] text-[10px] uppercase tracking-[0.2em] text-white/40">Modo apresentação · P ou Esc para sair</p>
      )}

      <div className={`pointer-events-none absolute inset-0 transition-opacity duration-500 ${showHud ? 'opacity-100' : 'opacity-0 [&_*]:pointer-events-none!'}`}>
        {/* busca (topo central; no celular ocupa o topo e empurra o painel de status) */}
        <div className="absolute left-1/2 top-4 z-10 w-[min(420px,calc(100vw-42rem))] -translate-x-1/2 max-[1100px]:left-4 max-[1100px]:w-[min(420px,calc(100vw-8rem))] max-[1100px]:translate-x-0">
          <SearchBar onSelect={goToPlace} onClear={clearPlace} />
        </div>

        {/* superior esquerdo: identificação + status */}
        <Panel className="absolute left-4 top-4 w-[min(290px,calc(100vw-8rem))] max-[1100px]:top-[4.5rem]">
          <div className="flex items-center justify-between">
            <h1 className="text-[13px] font-semibold tracking-[0.22em] text-white">ORBITAL<span className="text-ember">//</span>SYS-01</h1>
            <span className="text-[10px] text-white/35">v1.1</span>
          </div>
          <div className="mt-2 flex items-center gap-2 text-[11px] tracking-[0.14em]">
            <span className={`pulse-dot h-2 w-2 rounded-full ${status.color} shadow-[0_0_10px_currentColor]`} />
            <span className="text-white/80">{cursor !== null && mode === 'sismico' ? 'REPLAY · 24 H' : status.text}</span>
          </div>
          <div className="mt-2 border-t border-white/10 pt-2 max-[700px]:hidden">
            <Stat label="FPS" value={stats.fps.toFixed(0)} />
            <Stat label="Partículas" value={fmtInt(stats.particles)} />
            <Stat label="Fluxos ativos" value={stats.arcs} />
            <Stat label="Pontos de terra" value={fmtInt(stats.landDots)} />
          </div>
        </Panel>

        {/* inferior esquerdo: estatísticas + legenda */}
        <Panel title={mode === 'sismico' ? 'Atividade sísmica · 24 h' : 'Tráfego global · simulado'} className="absolute bottom-4 left-4 w-[min(320px,calc(100vw-2rem))]">
          {mode === 'sismico' ? (
            <>
              <Stat label="Eventos (M2.5+)" value={visibleEvents.length} accent />
              <Stat label="Maior magnitude" value={summary.strongest ? `M ${summary.strongest.magnitude?.toFixed(1)}` : '—'} accent />
              <p className="truncate pb-1 text-right text-[10px] text-white/40">{summary.strongest?.detail ?? ''}</p>
              <Stat label="Magnitude média" value={summary.avgMag?.toFixed(2) ?? '—'} />
              <Stat label="Profundidade média" value={`${summary.avgDepth?.toFixed(0) ?? '—'} km`} />
              <div className="mt-2 border-t border-white/10 pt-2" aria-label="Legenda de profundidade">
                <p className="hud-title mb-1.5 !text-[9px]">Cor = profundidade · tamanho = magnitude</p>
                <ul className="space-y-0.5">
                  {DEPTH_CLASSES.map((c, i) => (
                    <li key={c.id} className="flex items-center gap-2 text-[10px]">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: c.color, boxShadow: `0 0 8px ${c.color}` }} />
                      <span className="text-white/80">{c.label}</span>
                      <span className="text-white/35">{c.range}</span>
                      <span className="ml-auto tabular-nums text-white/70">{summary.byDepth?.[i] ?? 0}</span>
                    </li>
                  ))}
                </ul>
              </div>
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

        {/* inferior central: linha do tempo (modo sísmico) */}
        {mode === 'sismico' && events.length > 0 && (
          <div className="absolute bottom-4 left-1/2 w-[min(560px,calc(100vw-38rem))] -translate-x-1/2 max-[1000px]:hidden">
            <Timeline events={events} start={timeStart} end={timeEnd} cursor={cursor} playing={playing} onCursor={setCursor} onPlay={play} />
          </div>
        )}

        {/* destino da busca */}
        {place && (
          <div key={place.id} className="caption-in absolute bottom-[8.5rem] left-1/2 w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 max-[1000px]:bottom-auto max-[1000px]:top-[13rem]">
            <Panel>
              <p className="text-[10px] uppercase tracking-[0.24em] text-plasma">Destino</p>
              <p className="mt-0.5 text-[18px] font-semibold text-white">{place.name}</p>
              <p className="truncate text-[11px] text-white/55">{place.detail}</p>
              <p className="mt-1 text-[10px] tabular-nums text-white/40">{fmtCoord(place.lat, place.lon)}</p>
              <p className="mt-2 border-t border-white/10 pt-2 text-[11px] text-white/70">
                {nearby.length === 0
                  ? `Nenhum ${mode === 'sismico' ? 'evento sísmico' : 'fluxo'} a menos de ${NEARBY_KM} km agora.`
                  : (
                    <button className="text-left hover:text-white" onClick={() => focus(nearby[0].e)}>
                      {nearby.length} {mode === 'sismico' ? (nearby.length === 1 ? 'evento sísmico' : 'eventos sísmicos') : (nearby.length === 1 ? 'fluxo' : 'fluxos')} a menos de {NEARBY_KM} km · mais próximo: <span className="text-gold">{nearby[0].e.label}</span> a {nearby[0].d.toFixed(0)} km
                    </button>
                  )}
              </p>
            </Panel>
          </div>
        )}

        {/* lateral direita: feed retrátil */}
        <aside
          className={`absolute right-4 top-4 flex max-h-[calc(100%-15rem)] w-[min(340px,calc(100vw-2rem))] flex-col transition-transform duration-500 ease-out ${feedOpen ? 'translate-x-0' : 'translate-x-[calc(100%+1.5rem)]'}`}
          aria-hidden={!feedOpen}
        >
          <Panel
            title={`Event feed · ${visibleEvents.length}`}
            className="flex min-h-0 flex-col"
            right={<button className="min-h-8 min-w-8 text-white/50 hover:text-white focus-visible:ring-1 focus-visible:ring-ember" onClick={() => setFeedOpen(false)} aria-label="Recolher feed">×</button>}
          >
            <ul className="scrollbar-thin -mx-3 max-h-[60vh] overflow-y-auto">
              {visibleEvents.length === 0 && <li className="px-3 py-6 text-center text-[11px] text-white/40">{snap ? 'Nenhum evento neste momento da linha do tempo.' : 'Aguardando dados…'}</li>}
              {visibleEvents.map((e) => {
                const dc = depthClass(e.depthKm)
                const dot = dc?.color ?? `hsl(${40 - e.intensity * 40} 100% ${75 - e.intensity * 20}%)`
                return (
                  <li key={e.id}>
                    <button
                      onClick={() => focus(e)}
                      className={`group flex w-full items-start gap-3 border-l-2 px-3 py-2 text-left outline-none transition-colors hover:bg-white/5 focus-visible:bg-white/5 ${selected === e.id ? 'border-ember bg-white/[0.06]' : 'border-transparent'}`}
                    >
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: dot, boxShadow: `0 0 ${4 + e.intensity * 10}px ${dot}` }} />
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
                )
              })}
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
          <Toggle label="Modo apresentação" checked={presentation} onChange={setPresentation} hint="P" />
          <Toggle label="Calibração" checked={guiOpen} onChange={() => setGuiOpen(sceneRef.current?.toggleGui() ?? false)} hint="G" />
        </Panel>
      </div>

      {/* mobile: barra compacta de modo */}
      {showHud && (
        <div className="pointer-events-auto absolute bottom-[19rem] left-1/2 hidden -translate-x-1/2 max-[700px]:block">
          <button onClick={() => setMode((m) => (m === 'sismico' ? 'trafego' : 'sismico'))} className="hud-panel min-h-11 px-4 text-[11px] uppercase tracking-[0.16em] text-gold">
            Modo: {mode === 'sismico' ? 'Sísmico' : 'Tráfego'}
          </button>
        </div>
      )}
    </div>
  )
}
