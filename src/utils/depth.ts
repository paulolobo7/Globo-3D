/** Classes de profundidade sísmica (convenção usual da sismologia). */
export const DEPTH_CLASSES = [
  { id: 'rasa', label: 'Rasa', range: '0–70 km', max: 70, color: '#ff7a2a' },
  { id: 'intermediaria', label: 'Intermediária', range: '70–300 km', max: 300, color: '#ffd27a' },
  { id: 'profunda', label: 'Profunda', range: '> 300 km', max: Infinity, color: '#4da3ff' },
] as const

export function depthClass(depthKm: number | undefined) {
  if (depthKm == null) return null
  return DEPTH_CLASSES.find((c) => depthKm < c.max) ?? DEPTH_CLASSES[2]
}
