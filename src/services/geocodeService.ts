import { geoArea, geoBounds, geoCentroid } from 'd3-geo'
import { feature } from 'topojson-client'
import type { Topology, GeometryCollection } from 'topojson-specification'
import type { Feature, MultiPolygon, Polygon } from 'geojson'
import countriesTopo from 'world-atlas/countries-110m.json'
import { CITIES } from './dataService'

export interface Place {
  id: string
  name: string
  detail: string
  lat: number
  lon: number
  /** distância de câmera sugerida (raio do globo = 1) */
  distance: number
  source: 'local' | 'osm'
}

/** Nomes em português para os países mais buscados (o world-atlas vem em inglês). */
const PT: Record<string, string> = {
  Brazil: 'Brasil', 'United States of America': 'Estados Unidos', Germany: 'Alemanha', Spain: 'Espanha',
  France: 'França', Italy: 'Itália', Japan: 'Japão', Russia: 'Rússia', 'United Kingdom': 'Reino Unido',
  Mexico: 'México', Colombia: 'Colômbia', Canada: 'Canadá', Australia: 'Austrália', India: 'Índia',
  'South Africa': 'África do Sul', Egypt: 'Egito', Indonesia: 'Indonésia', Turkey: 'Turquia', Greece: 'Grécia',
  Netherlands: 'Países Baixos', Switzerland: 'Suíça', Sweden: 'Suécia', Norway: 'Noruega', Poland: 'Polônia',
  'Saudi Arabia': 'Arábia Saudita', 'South Korea': 'Coreia do Sul', 'North Korea': 'Coreia do Norte',
  'New Zealand': 'Nova Zelândia', Morocco: 'Marrocos', Nigeria: 'Nigéria', Kenya: 'Quênia', Uruguay: 'Uruguai',
  Paraguay: 'Paraguai', Bolivia: 'Bolívia', Ecuador: 'Equador', Iceland: 'Islândia', Ireland: 'Irlanda',
  Ukraine: 'Ucrânia', Iran: 'Irã', Iraq: 'Iraque', Thailand: 'Tailândia', Vietnam: 'Vietnã',
  Philippines: 'Filipinas', Greenland: 'Groenlândia', Antarctica: 'Antártida', Mongolia: 'Mongólia',
  Kazakhstan: 'Cazaquistão', Pakistan: 'Paquistão', Afghanistan: 'Afeganistão', Algeria: 'Argélia',
  Libya: 'Líbia', Ethiopia: 'Etiópia', Mozambique: 'Moçambique', Peru: 'Peru', Chile: 'Chile',
  Argentina: 'Argentina', Venezuela: 'Venezuela', Cuba: 'Cuba', Portugal: 'Portugal', China: 'China',
  Angola: 'Angola', Madagascar: 'Madagascar', Israel: 'Israel', Finland: 'Finlândia', Denmark: 'Dinamarca',
  Belgium: 'Bélgica', Austria: 'Áustria', Romania: 'Romênia', Hungary: 'Hungria', Czechia: 'Tchéquia',
  Nepal: 'Nepal', Malaysia: 'Malásia', 'Dem. Rep. Congo': 'Rep. Dem. do Congo', Sudan: 'Sudão',
  Tanzania: 'Tanzânia', Ghana: 'Gana', Senegal: 'Senegal', Cameroon: 'Camarões', Syria: 'Síria',
  Jordan: 'Jordânia', 'United Arab Emirates': 'Emirados Árabes Unidos', Qatar: 'Catar', Guatemala: 'Guatemala',
  Honduras: 'Honduras', Panama: 'Panamá', 'Costa Rica': 'Costa Rica', Haiti: 'Haiti', Jamaica: 'Jamaica',
}

export const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** Distância da câmera conforme o tamanho do lugar (em graus). */
export const distanceForSpan = (spanDeg: number) => 2.05 + Math.min(1.5, Math.sqrt(Math.max(0, spanDeg)) / 4.5)

let localIndex: (Place & { keys: string[] })[] | null = null

function buildLocalIndex() {
  const topo = countriesTopo as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>
  const fc = feature(topo, topo.objects.countries)
  const out: (Place & { keys: string[] })[] = []
  for (const f of fc.features as Feature<Polygon | MultiPolygon, { name: string }>[]) {
    if (!f.geometry) continue
    // usa o maior polígono (evita centróides no meio do oceano por causa de territórios ultramarinos)
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
    let best = polys[0], bestArea = -1
    for (const p of polys) {
      const a = geoArea({ type: 'Polygon', coordinates: p })
      if (a > bestArea) { bestArea = a; best = p }
    }
    const main = { type: 'Polygon' as const, coordinates: best }
    const [lon, lat] = geoCentroid(main)
    const [[x0, y0], [x1, y1]] = geoBounds(main)
    const span = Math.max(Math.abs(y1 - y0), Math.abs(((x1 - x0 + 360) % 360)))
    const en = f.properties.name
    const pt = PT[en] ?? en
    out.push({ id: `c-${en}`, name: pt, detail: 'País', lat, lon, distance: distanceForSpan(span), source: 'local', keys: [normalize(pt), normalize(en)] })
  }
  for (const c of CITIES) {
    out.push({ id: `city-${c.name}`, name: c.name, detail: 'Cidade · hub de dados', lat: c.lat, lon: c.lon, distance: distanceForSpan(0.3), source: 'local', keys: [normalize(c.name)] })
  }
  return out
}

/** Sugestões instantâneas, sem rede: países (110m) e cidades-hub. */
export function searchLocal(query: string, limit = 6): Place[] {
  const q = normalize(query)
  if (q.length < 2) return []
  localIndex ??= buildLocalIndex()
  const scored: { p: Place; score: number }[] = []
  for (const p of localIndex) {
    let score = 0
    for (const k of p.keys) {
      if (k === q) score = Math.max(score, 3)
      else if (k.startsWith(q)) score = Math.max(score, 2)
      else if (k.includes(q)) score = Math.max(score, 1)
    }
    if (score) scored.push({ p, score })
  }
  return scored.sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name)).slice(0, limit).map((s) => s.p)
}

interface NominatimResult {
  place_id: number
  lat: string
  lon: string
  display_name: string
  name?: string
  addresstype?: string
  boundingbox?: [string, string, string, string]
}

/**
 * Busca qualquer lugar do mundo no Nominatim (OpenStreetMap). Uso gratuito com limite
 * de 1 requisição por segundo: a barra de busca faz debounce e cancela as anteriores.
 */
export async function searchOnline(query: string, signal?: AbortSignal): Promise<Place[]> {
  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.search = new URLSearchParams({ q: query, format: 'jsonv2', limit: '6', 'accept-language': 'pt-BR' }).toString()
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = (await res.json()) as NominatimResult[]
  return json.map((r) => {
    const parts = r.display_name.split(',').map((s) => s.trim())
    const bb = r.boundingbox?.map(Number)
    const span = bb ? Math.max(Math.abs(bb[1] - bb[0]), Math.abs(bb[3] - bb[2])) : 1
    return {
      id: `osm-${r.place_id}`,
      name: r.name || parts[0],
      detail: parts.slice(1).slice(-3).join(', ') || r.addresstype || '',
      lat: parseFloat(r.lat),
      lon: parseFloat(r.lon),
      distance: distanceForSpan(span),
      source: 'osm' as const,
    }
  })
}
