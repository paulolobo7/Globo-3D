import * as THREE from 'three'

export const GLOBE_RADIUS = 1
const DEG = Math.PI / 180

/** Converte latitude/longitude (graus) em coordenadas cartesianas 3D (y = norte). */
export function latLonToVector3(lat: number, lon: number, radius = GLOBE_RADIUS, target = new THREE.Vector3()) {
  const phi = (90 - lat) * DEG // ângulo polar a partir do norte
  const theta = (lon + 180) * DEG
  return target.set(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  )
}

/** Operação inversa: vetor 3D -> { lat, lon } em graus. */
export function vector3ToLatLon(v: THREE.Vector3) {
  const r = v.length()
  const lat = 90 - Math.acos(v.y / r) / DEG
  let lon = Math.atan2(v.z, -v.x) / DEG - 180
  if (lon < -180) lon += 360
  return { lat, lon }
}

/** Distância de grande círculo em km (haversine). */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371
  const dLat = (lat2 - lat1) * DEG
  const dLon = (lon2 - lon1) * DEG
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/**
 * Pontos de controle de uma Bézier cúbica entre dois pontos da superfície.
 * A altura do arco cresce com a distância angular, para o arco "abraçar" o globo.
 */
export function arcControlPoints(a: THREE.Vector3, b: THREE.Vector3, radius = GLOBE_RADIUS) {
  const angle = a.angleTo(b)
  const lift = radius * (1 + 0.12 + angle * 0.55)
  const mid = a.clone().add(b).multiplyScalar(0.5)
  if (mid.lengthSq() < 1e-6) mid.set(0, 1, 0) // antípodas
  const c1 = a.clone().lerp(b, 0.25).normalize().multiplyScalar(lift)
  const c2 = a.clone().lerp(b, 0.75).normalize().multiplyScalar(lift)
  return [a.clone(), c1, c2, b.clone()] as const
}

/** Pontos distribuídos uniformemente na esfera (espiral de Fibonacci). */
export function fibonacciSphere(count: number) {
  const out: { lat: number; lon: number }[] = []
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2
    const theta = golden * i
    const lat = Math.asin(y) / DEG
    let lon = ((theta / DEG) % 360) - 180
    out.push({ lat, lon })
  }
  return out
}
