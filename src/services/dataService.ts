import { haversineKm } from '../utils/geo'

export type DataMode = 'sismico' | 'trafego'
export type FeedStatus = 'conectando' | 'ao-vivo' | 'offline' | 'simulado'

export interface GeoEvent {
  id: string
  lat: number
  lon: number
  /** 0..1, usado para tamanho/brilho dos pins */
  intensity: number
  label: string
  detail: string
  time: number
  magnitude?: number
  depthKm?: number
}

export interface GeoArc {
  id: string
  from: { lat: number; lon: number }
  to: { lat: number; lon: number }
  /** 0..1 — define densidade e velocidade das partículas */
  weight: number
  born: number
}

export interface Snapshot {
  status: FeedStatus
  events: GeoEvent[]
  arcs: GeoArc[]
  fetchedAt: number
  source: string
}

const USGS_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson'

/** Grandes cidades (hubs de dados) — coordenadas aproximadas. */
export const CITIES = [
  { name: 'São Paulo', lat: -23.55, lon: -46.63 },
  { name: 'São Luís', lat: -2.53, lon: -44.3 },
  { name: 'Rio de Janeiro', lat: -22.91, lon: -43.17 },
  { name: 'Buenos Aires', lat: -34.6, lon: -58.38 },
  { name: 'Santiago', lat: -33.45, lon: -70.67 },
  { name: 'Bogotá', lat: 4.71, lon: -74.07 },
  { name: 'Cidade do México', lat: 19.43, lon: -99.13 },
  { name: 'Miami', lat: 25.76, lon: -80.19 },
  { name: 'Nova York', lat: 40.71, lon: -74.0 },
  { name: 'Ashburn', lat: 39.04, lon: -77.49 },
  { name: 'São Francisco', lat: 37.77, lon: -122.42 },
  { name: 'Toronto', lat: 43.65, lon: -79.38 },
  { name: 'Londres', lat: 51.51, lon: -0.13 },
  { name: 'Frankfurt', lat: 50.11, lon: 8.68 },
  { name: 'Amsterdã', lat: 52.37, lon: 4.9 },
  { name: 'Paris', lat: 48.86, lon: 2.35 },
  { name: 'Madri', lat: 40.42, lon: -3.7 },
  { name: 'Lisboa', lat: 38.72, lon: -9.14 },
  { name: 'Estocolmo', lat: 59.33, lon: 18.07 },
  { name: 'Lagos', lat: 6.52, lon: 3.38 },
  { name: 'Joanesburgo', lat: -26.2, lon: 28.05 },
  { name: 'Cairo', lat: 30.04, lon: 31.24 },
  { name: 'Nairóbi', lat: -1.29, lon: 36.82 },
  { name: 'Dubai', lat: 25.2, lon: 55.27 },
  { name: 'Mumbai', lat: 19.08, lon: 72.88 },
  { name: 'Singapura', lat: 1.35, lon: 103.82 },
  { name: 'Hong Kong', lat: 22.32, lon: 114.17 },
  { name: 'Tóquio', lat: 35.68, lon: 139.69 },
  { name: 'Seul', lat: 37.57, lon: 126.98 },
  { name: 'Sydney', lat: -33.87, lon: 151.21 },
  { name: 'Auckland', lat: -36.85, lon: 174.76 },
  { name: 'Moscou', lat: 55.76, lon: 37.62 },
] as const

let arcSeq = 0
const rand = (a: number, b: number) => a + Math.random() * (b - a)
const pick = <T,>(arr: readonly T[]) => arr[Math.floor(Math.random() * arr.length)]

// ---------------------------------------------------------------- Sísmico (USGS)

interface UsgsFeature {
  id: string
  geometry: { coordinates: [number, number, number] }
  properties: { mag: number | null; place: string | null; time: number; title: string }
}

function nearestCities(lat: number, lon: number, n: number) {
  return [...CITIES]
    .map((c) => ({ c, d: haversineKm(lat, lon, c.lat, c.lon) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
}

function quakesToSnapshot(features: UsgsFeature[], status: FeedStatus, source: string): Snapshot {
  const now = Date.now()
  const events: GeoEvent[] = features
    .filter((f) => f.properties.mag != null)
    .map((f) => {
      const [lon, lat, depth] = f.geometry.coordinates
      const mag = f.properties.mag ?? 0
      return {
        id: f.id,
        lat,
        lon,
        magnitude: mag,
        depthKm: depth,
        intensity: Math.min(1, Math.max(0.08, (mag - 2.5) / 4.5)),
        label: `M ${mag.toFixed(1)}`,
        detail: f.properties.place ?? 'Local desconhecido',
        time: f.properties.time,
      }
    })
    .sort((a, b) => b.time - a.time)

  // Arcos: "ondas de alerta" dos eventos mais fortes até as cidades-hub mais próximas.
  const strongest = [...events].sort((a, b) => (b.magnitude ?? 0) - (a.magnitude ?? 0)).slice(0, 14)
  const arcs: GeoArc[] = strongest.flatMap((e) =>
    nearestCities(e.lat, e.lon, e.intensity > 0.5 ? 3 : 2).map(({ c }) => ({
      id: `q-${e.id}-${c.name}`,
      from: { lat: e.lat, lon: e.lon },
      to: { lat: c.lat, lon: c.lon },
      weight: 0.35 + e.intensity * 0.65,
      born: now,
    })),
  )
  return { status, events, arcs, fetchedAt: now, source }
}

/** Dados de demonstração usados só quando a API da USGS não responde (ex.: sem internet no palco). */
function demoQuakes(): UsgsFeature[] {
  const zones = [
    [35.7, 139.7, 'Honshu, Japão'], [-33.4, -71.6, 'Valparaíso, Chile'], [-6.2, 130.1, 'Mar de Banda, Indonésia'],
    [61.2, -150.0, 'Sul do Alasca'], [36.1, -117.6, 'Califórnia'], [18.4, -66.1, 'Porto Rico'],
    [-15.5, -173.0, 'Tonga'], [38.4, 38.9, 'Leste da Turquia'], [-41.3, 174.8, 'Nova Zelândia'],
    [14.6, -91.0, 'Guatemala'], [-4.5, 152.5, 'Nova Bretanha, PNG'], [40.8, 14.2, 'Campos Flégreos, Itália'],
    [19.4, -155.3, 'Havaí'], [-20.5, -69.2, 'Tarapacá, Chile'], [52.5, 160.0, 'Kamchatka, Rússia'],
  ] as const
  const now = Date.now()
  return Array.from({ length: 48 }, (_, i) => {
    const [lat, lon, place] = zones[i % zones.length]
    const mag = 2.5 + Math.pow(Math.random(), 2.4) * 4.2
    return {
      id: `demo-${i}`,
      geometry: { coordinates: [lon + rand(-2.5, 2.5), lat + rand(-2.5, 2.5), rand(5, 120)] },
      properties: { mag, place: `${Math.round(rand(5, 90))} km de ${place}`, time: now - i * rand(8, 40) * 60_000, title: '' },
    }
  })
}

export async function fetchEarthquakes(signal?: AbortSignal): Promise<Snapshot> {
  try {
    const res = await fetch(USGS_URL, { signal, cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = (await res.json()) as { features: UsgsFeature[] }
    return quakesToSnapshot(json.features, 'ao-vivo', 'USGS · 2.5_day.geojson')
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    console.warn('[dataService] USGS indisponível, usando dados de demonstração', err)
    return quakesToSnapshot(demoQuakes(), 'offline', 'DEMO · USGS indisponível')
  }
}

// ---------------------------------------------------------------- Tráfego (simulado)

const TRAFFIC_KINDS = ['CDN sync', 'Backup', 'Pagamentos', 'Streaming', 'API gateway', 'Replicação DB', 'Telemetria'] as const

export function makeTrafficArc(now = Date.now()): { arc: GeoArc; event: GeoEvent } {
  let a = pick(CITIES)
  let b = pick(CITIES)
  while (b === a) b = pick(CITIES)
  if (Math.random() < 0.3) a = CITIES[0] // São Paulo como hub principal
  if (a === b) b = CITIES[12]
  const weight = Math.pow(Math.random(), 0.7)
  const gbps = (weight * 380 + 4).toFixed(1)
  const id = `t-${++arcSeq}`
  return {
    arc: { id, from: { lat: a.lat, lon: a.lon }, to: { lat: b.lat, lon: b.lon }, weight, born: now },
    event: {
      id,
      lat: b.lat,
      lon: b.lon,
      intensity: 0.25 + weight * 0.75,
      label: `${gbps} Gb/s`,
      detail: `${a.name} → ${b.name} · ${pick(TRAFFIC_KINDS)}`,
      time: now,
    },
  }
}

export function initialTraffic(count = 34): Snapshot {
  const now = Date.now()
  const arcs: GeoArc[] = []
  const events: GeoEvent[] = []
  for (let i = 0; i < count; i++) {
    const { arc, event } = makeTrafficArc(now - i * 1500)
    arcs.push(arc)
    events.push(event)
  }
  return { status: 'simulado', events, arcs, fetchedAt: now, source: 'SIMULADOR · tráfego entre hubs' }
}
