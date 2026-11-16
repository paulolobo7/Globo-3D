import * as THREE from 'three'
import { geoEquirectangular, geoPath } from 'd3-geo'
import { feature } from 'topojson-client'
import type { Topology, GeometryCollection } from 'topojson-specification'
import landTopo from 'world-atlas/land-110m.json'
import { GLOBE_RADIUS, fibonacciSphere, latLonToVector3 } from '../utils/geo'

/** Rasteriza os continentes num canvas equiretangular para testar "é terra?" por pixel. */
function buildLandMask(width = 2048, height = 1024) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const topo = landTopo as unknown as Topology<{ land: GeometryCollection }>
  const land = feature(topo, topo.objects.land)
  const projection = geoEquirectangular().scale(width / (2 * Math.PI)).translate([width / 2, height / 2])
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  geoPath(projection, ctx)(land)
  ctx.fill()
  const data = ctx.getImageData(0, 0, width, height).data
  const isLand = (lat: number, lon: number) => {
    const x = Math.min(width - 1, Math.max(0, Math.floor(((lon + 180) / 360) * width)))
    const y = Math.min(height - 1, Math.max(0, Math.floor(((90 - lat) / 180) * height)))
    return data[(y * width + x) * 4 + 3] > 128
  }
  // contornos (litoral) como anéis de [lon, lat]
  const rings: [number, number][][] = []
  for (const f of land.features) {
    const g = f.geometry
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
    for (const poly of polys) for (const ring of poly) rings.push(ring as [number, number][])
  }
  return { isLand, canvas, rings }
}

/** Litoral como segmentos de linha levemente acima da superfície. */
function buildCoastlines(rings: [number, number][][], radius: number) {
  const pos: number[] = []
  const a = new THREE.Vector3(), b = new THREE.Vector3()
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const [lon1, lat1] = ring[i]
      const [lon2, lat2] = ring[i + 1]
      if (Math.abs(lon1 - lon2) > 180) continue // corte no antimeridiano
      latLonToVector3(lat1, lon1, radius, a)
      latLonToVector3(lat2, lon2, radius, b)
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  return g
}

const coastVertex = /* glsl */ `
  varying float vFacing;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * normalize(position));
    vFacing = dot(n, normalize(-mv.xyz));
    gl_Position = projectionMatrix * mv;
  }
`
const coastFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vFacing;
  void main() {
    float vis = smoothstep(0.0, 0.25, vFacing);
    gl_FragColor = vec4(uColor * uOpacity, vis);
  }
`

const dotsVertex = /* glsl */ `
  uniform float uTime;
  uniform float uSize;
  uniform float uPixelRatio;
  attribute float aSeed;
  varying float vSeed;
  varying float vFacing;
  void main() {
    vSeed = aSeed;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * normalize(position));
    vFacing = dot(n, normalize(-mv.xyz));
    gl_Position = projectionMatrix * mv;
    float twinkle = 0.75 + 0.25 * sin(uTime * (1.0 + aSeed * 3.0) + aSeed * 40.0);
    gl_PointSize = uSize * uPixelRatio * twinkle * (1.0 / -mv.z) * 3.2;
  }
`
const dotsFragment = /* glsl */ `
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uBrightness;
  varying float vSeed;
  varying float vFacing;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float core = smoothstep(0.5, 0.0, d);
    vec3 col = mix(uColorA, uColorB, step(0.72, vSeed));
    // limbo mais brilhante, centro levemente mais escuro (efeito vidro)
    float rim = 1.0 + 0.6 * pow(1.0 - clamp(vFacing, 0.0, 1.0), 2.0);
    gl_FragColor = vec4(col * uBrightness * rim, core * smoothstep(-0.05, 0.15, vFacing));
  }
`

const globeVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`
const globeFragment = /* glsl */ `
  uniform float uTime;
  uniform float uIridescence;
  uniform sampler2D uLand;
  uniform float uLandFill;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec2 vUv;
  void main() {
    float f = 1.0 - clamp(dot(vNormal, vView), 0.0, 1.0);
    float fres = pow(f, 3.0);
    // filme fino: cor iridescente que varia com o ângulo de visão
    vec3 thinFilm = 0.5 + 0.5 * cos(6.2831 * (f * 1.6 + vec3(0.0, 0.33, 0.67) + uTime * 0.03));
    vec3 base = vec3(0.008, 0.01, 0.02);
    // especular "vidro" de uma luz fixa em relação à câmera
    vec3 L = normalize(vec3(-0.6, 0.7, 0.5));
    float spec = pow(max(dot(reflect(-L, vNormal), vView), 0.0), 140.0);
    // preenchimento sutil dos continentes: dá forma mesmo entre os pontos
    float land = texture2D(uLand, vUv).a;
    float facing = clamp(dot(vNormal, vView), 0.0, 1.0);
    base += vec3(0.16, 0.12, 0.08) * land * uLandFill * (0.35 + 0.65 * facing);
    vec3 col = base + thinFilm * fres * uIridescence + vec3(1.0, 0.9, 0.8) * spec * 0.12;
    gl_FragColor = vec4(col, 1.0);
  }
`

const atmoVertex = /* glsl */ `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const atmoFragment = /* glsl */ `
  uniform float uIntensity;
  uniform float uLimb;
  uniform float uTime;
  varying vec3 vNormal;
  // rampa prismática: branco-ouro -> laranja -> vermelho -> violeta -> azul elétrico
  vec3 ramp(float k) {
    vec3 c = vec3(0.0);
    c = mix(vec3(0.15, 0.35, 1.0), vec3(0.55, 0.15, 0.9), smoothstep(0.08, 0.32, k));
    c = mix(c, vec3(1.0, 0.12, 0.05), smoothstep(0.30, 0.50, k));
    c = mix(c, vec3(1.0, 0.48, 0.08), smoothstep(0.48, 0.70, k));
    c = mix(c, vec3(1.0, 0.85, 0.55), smoothstep(0.78, 0.98, k));
    return c;
  }
  void main() {
    float k = clamp(-vNormal.z / uLimb, 0.0, 1.0);
    float shimmer = 0.92 + 0.08 * sin(uTime * 0.8 + k * 18.0);
    float a = pow(k, 3.2) * smoothstep(0.0, 0.25, k);
    gl_FragColor = vec4(ramp(k) * a * uIntensity * shimmer, 1.0);
  }
`

export class EarthMesh {
  readonly group = new THREE.Group()
  readonly dots: THREE.Points
  readonly atmosphere: THREE.Mesh
  readonly globe: THREE.Mesh
  private dotsMat: THREE.ShaderMaterial
  private globeMat: THREE.ShaderMaterial
  private atmoMat: THREE.ShaderMaterial
  private coastMat: THREE.ShaderMaterial
  readonly coast: THREE.LineSegments
  landDotCount = 0

  constructor(pixelRatio: number) {
    // Esfera escura com brilho especular e borda iridescente
    const mask = buildLandMask()
    const landTex = new THREE.CanvasTexture(mask.canvas)
    landTex.colorSpace = THREE.NoColorSpace
    landTex.anisotropy = 4
    this.globeMat = new THREE.ShaderMaterial({
      vertexShader: globeVertex,
      fragmentShader: globeFragment,
      uniforms: {
        uTime: { value: 0 },
        uIridescence: { value: 0.22 },
        uLand: { value: landTex },
        uLandFill: { value: 1 },
      },
    })
    this.globe = new THREE.Mesh(new THREE.SphereGeometry(GLOBE_RADIUS * 0.995, 96, 96), this.globeMat)
    this.group.add(this.globe)

    // Continentes em pontos
    const isLand = mask.isLand
    const samples = fibonacciSphere(115_000)
    const pos: number[] = []
    const seeds: number[] = []
    const v = new THREE.Vector3()
    for (const s of samples) {
      if (!isLand(s.lat, s.lon)) continue
      // jitter leve quebra o padrão de moiré da espiral de Fibonacci
      latLonToVector3(s.lat + (Math.random() - 0.5) * 0.25, s.lon + (Math.random() - 0.5) * 0.25, GLOBE_RADIUS * 1.002, v)
      pos.push(v.x, v.y, v.z)
      seeds.push(Math.random())
    }
    this.landDotCount = seeds.length
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1))
    this.dotsMat = new THREE.ShaderMaterial({
      vertexShader: dotsVertex,
      fragmentShader: dotsFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: 1.55 },
        uPixelRatio: { value: pixelRatio },
        uColorA: { value: new THREE.Color('#dfe6ff') },
        uColorB: { value: new THREE.Color('#ffc566') },
        uBrightness: { value: 0.75 },
      },
    })
    this.dots = new THREE.Points(g, this.dotsMat)
    this.group.add(this.dots)

    // litoral
    this.coastMat = new THREE.ShaderMaterial({
      vertexShader: coastVertex,
      fragmentShader: coastFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color('#ffd9a0') }, uOpacity: { value: 0.55 } },
    })
    this.coast = new THREE.LineSegments(buildCoastlines(mask.rings, GLOBE_RADIUS * 1.003), this.coastMat)
    this.group.add(this.coast)

    // Atmosfera prismática (fresnel, lado de trás)
    const atmoR = 1.38
    this.atmoMat = new THREE.ShaderMaterial({
      vertexShader: atmoVertex,
      fragmentShader: atmoFragment,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uIntensity: { value: 0.6 },
        uLimb: { value: Math.sqrt(1 - 1 / (atmoR * atmoR)) },
        uTime: { value: 0 },
      },
    })
    this.atmosphere = new THREE.Mesh(new THREE.SphereGeometry(GLOBE_RADIUS * atmoR, 96, 96), this.atmoMat)
    this.group.add(this.atmosphere)
  }

  set atmosphereIntensity(v: number) { this.atmoMat.uniforms.uIntensity.value = v }
  get atmosphereIntensity() { return this.atmoMat.uniforms.uIntensity.value }
  set iridescence(v: number) { this.globeMat.uniforms.uIridescence.value = v }
  get iridescence() { return this.globeMat.uniforms.uIridescence.value }
  set dotSize(v: number) { this.dotsMat.uniforms.uSize.value = v }
  get dotSize() { return this.dotsMat.uniforms.uSize.value }
  set dotBrightness(v: number) { this.dotsMat.uniforms.uBrightness.value = v }
  get dotBrightness() { return this.dotsMat.uniforms.uBrightness.value }

  set coastOpacity(v: number) { this.coastMat.uniforms.uOpacity.value = v }
  get coastOpacity() { return this.coastMat.uniforms.uOpacity.value }
  set landFill(v: number) { this.globeMat.uniforms.uLandFill.value = v }
  get landFill() { return this.globeMat.uniforms.uLandFill.value }

  setPixelRatio(pr: number) { this.dotsMat.uniforms.uPixelRatio.value = pr }

  update(t: number) {
    this.dotsMat.uniforms.uTime.value = t
    this.globeMat.uniforms.uTime.value = t
    this.atmoMat.uniforms.uTime.value = t
  }
}
