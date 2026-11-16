import * as THREE from 'three'
import type { GeoEvent } from '../services/dataService'
import { latLonToVector3 } from '../utils/geo'

/**
 * Pins como mini "erupções": núcleo incandescente, ondas de choque concêntricas,
 * faíscas ejetadas e (nos mais fortes) um lens flare anamórfico.
 */

const ringVertex = /* glsl */ `
  attribute float aSeed;
  attribute float aIntensity;
  varying vec2 vUv;
  varying float vSeed;
  varying float vIntensity;
  void main() {
    vUv = uv; vSeed = aSeed; vIntensity = aIntensity;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`
const ringFragment = /* glsl */ `
  uniform float uTime;
  uniform float uBrightness;
  varying vec2 vUv;
  varying float vSeed;
  varying float vIntensity;
  vec3 heat(float w) {
    vec3 c = mix(vec3(1.0, 0.95, 0.85), vec3(1.0, 0.5, 0.1), smoothstep(0.0, 0.45, w));
    return mix(c, vec3(0.9, 0.08, 0.05), smoothstep(0.45, 1.0, w));
  }
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    if (r > 1.0) discard;
    vec3 col = vec3(0.0);
    float alpha = 0.0;
    for (int i = 0; i < 3; i++) {
      float w = fract(uTime * (0.35 + vIntensity * 0.4) + float(i) / 3.0 + vSeed);
      float ring = smoothstep(0.06, 0.0, abs(r - w)) * (1.0 - w);
      col += heat(w) * ring;
      alpha += ring;
    }
    float glow = smoothstep(0.35, 0.0, r) * 0.6;
    col += vec3(1.0, 0.75, 0.4) * glow;
    gl_FragColor = vec4(col * uBrightness * (0.5 + vIntensity), clamp(alpha + glow, 0.0, 1.0));
  }
`

const sparkVertex = /* glsl */ `
  uniform float uTime;
  uniform float uSize;
  uniform float uPixelRatio;
  attribute vec3 aDir;
  attribute vec3 aData; // fase, velocidade, intensidade
  varying float vLife;
  varying float vIntensity;
  void main() {
    float life = fract(aData.x + uTime * aData.y);
    vLife = life; vIntensity = aData.z;
    vec3 n = normalize(position);
    // trajetória balística: sobe pela normal e "cai" de volta
    float h = life * (0.05 + aData.z * 0.14);
    vec3 p = position + aDir * h - n * life * life * (0.04 + aData.z * 0.08);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uPixelRatio * (1.0 - life) * (0.5 + aData.z) / -mv.z;
  }
`
const sparkFragment = /* glsl */ `
  varying float vLife;
  varying float vIntensity;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    vec3 col = mix(vec3(1.0, 0.95, 0.8), vec3(1.0, 0.25, 0.05), vLife);
    gl_FragColor = vec4(col * 1.1, smoothstep(0.5, 0.0, d) * (1.0 - vLife));
  }
`

const coreVertex = /* glsl */ `
  uniform float uTime;
  uniform float uSize;
  uniform float uPixelRatio;
  attribute vec2 aData; // intensidade, seed
  attribute float aSelected;
  varying float vIntensity;
  varying float vSelected;
  void main() {
    vIntensity = aData.x; vSelected = aSelected;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float pulse = 0.8 + 0.2 * sin(uTime * 4.0 + aData.y * 30.0);
    gl_PointSize = uSize * uPixelRatio * (0.4 + aData.x * 1.4) * pulse * (1.0 + aSelected * 1.5) / -mv.z;
  }
`
const coreFragment = /* glsl */ `
  varying float vIntensity;
  varying float vSelected;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float core = exp(-d * d * 10.0);
    float halo = exp(-d * 3.5) * 0.5;
    vec3 col = mix(vec3(1.0, 0.45, 0.12), vec3(1.0, 0.97, 0.9), core);
    col = mix(col, vec3(0.5, 0.85, 1.0), vSelected * (1.0 - core) * 0.6);
    gl_FragColor = vec4(col * (0.7 + vIntensity * 1.3), core + halo);
  }
`

const flareVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`
const flareFragment = /* glsl */ `
  uniform float uOpacity;
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float streak = exp(-abs(p.y) * 70.0) * exp(-abs(p.x) * 3.2);
    vec2 q = vec2(p.x * 3.0, p.y);
    float streakV = exp(-abs(q.x) * 30.0) * exp(-abs(q.y) * 4.0) * 0.35;
    float r = length(q);
    float glow = exp(-r * 7.0) * 0.8;
    // halo espectral (difração) em volta do ponto
    float ring = smoothstep(0.05, 0.0, abs(r - 0.42)) * 0.35;
    vec3 spectrum = 0.5 + 0.5 * cos(6.2831 * (r * 2.4 + vec3(0.0, 0.33, 0.67)));
    vec3 col = vec3(1.0, 0.7, 0.4) * streak + vec3(0.6, 0.8, 1.0) * streakV + spectrum * ring + vec3(1.0, 0.85, 0.7) * glow;
    col *= 0.85 + 0.15 * sin(uTime * 7.0);
    gl_FragColor = vec4(col * uOpacity, 1.0);
  }
`

const MAX_PINS = 160
const SPARKS_PER_PIN = 26
const MAX_FLARES = 4

export class PinsLayer {
  readonly group = new THREE.Group()
  private rings: THREE.InstancedMesh
  private ringMat: THREE.ShaderMaterial
  private sparks: THREE.Points
  private sparkMat: THREE.ShaderMaterial
  private cores: THREE.Points
  private coreMat: THREE.ShaderMaterial
  private flares: THREE.Mesh[] = []
  private flareAnchors: { pos: THREE.Vector3; strength: number }[] = []
  private events: GeoEvent[] = []
  private selectedId: string | null = null
  flaresEnabled = true

  constructor(pixelRatio: number) {
    this.ringMat = new THREE.ShaderMaterial({
      vertexShader: ringVertex, fragmentShader: ringFragment,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uBrightness: { value: 0.8 } },
    })
    const plane = new THREE.PlaneGeometry(1, 1)
    plane.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(MAX_PINS), 1))
    plane.setAttribute('aIntensity', new THREE.InstancedBufferAttribute(new Float32Array(MAX_PINS), 1))
    this.rings = new THREE.InstancedMesh(plane, this.ringMat, MAX_PINS)
    this.rings.count = 0
    this.rings.frustumCulled = false

    this.sparkMat = new THREE.ShaderMaterial({
      vertexShader: sparkVertex, fragmentShader: sparkFragment,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uSize: { value: 7 }, uPixelRatio: { value: pixelRatio } },
    })
    this.sparks = new THREE.Points(new THREE.BufferGeometry(), this.sparkMat)
    this.sparks.frustumCulled = false

    this.coreMat = new THREE.ShaderMaterial({
      vertexShader: coreVertex, fragmentShader: coreFragment,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uSize: { value: 45 }, uPixelRatio: { value: pixelRatio } },
    })
    this.cores = new THREE.Points(new THREE.BufferGeometry(), this.coreMat)
    this.cores.frustumCulled = false

    for (let i = 0; i < MAX_FLARES; i++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.ShaderMaterial({
          vertexShader: flareVertex, fragmentShader: flareFragment,
          transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
          uniforms: { uOpacity: { value: 0 }, uTime: { value: 0 } },
        }),
      )
      m.visible = false
      m.renderOrder = 10
      this.flares.push(m)
      this.group.add(m)
    }
    this.group.add(this.rings, this.sparks, this.cores)
  }

  get ringUniforms() { return this.ringMat.uniforms }
  get coreUniforms() { return this.coreMat.uniforms }

  setPixelRatio(pr: number) {
    this.sparkMat.uniforms.uPixelRatio.value = pr
    this.coreMat.uniforms.uPixelRatio.value = pr
  }

  /** Posições (mundo) dos pins mais quentes — usadas pela distorção de calor no pós-processamento. */
  get hotspots() { return this.flareAnchors }

  setSelected(id: string | null) {
    this.selectedId = id
    this.setEvents(this.events)
  }

  setEvents(events: GeoEvent[]) {
    this.events = events.slice(0, MAX_PINS)
    const n = this.events.length
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3()
    const up = new THREE.Vector3(0, 0, 1)
    const seeds = this.rings.geometry.getAttribute('aSeed') as THREE.InstancedBufferAttribute
    const ints = this.rings.geometry.getAttribute('aIntensity') as THREE.InstancedBufferAttribute

    const corePos = new Float32Array(n * 3), coreData = new Float32Array(n * 2), coreSel = new Float32Array(n)
    const sparkPos: number[] = [], sparkDir: number[] = [], sparkData: number[] = []
    const v = new THREE.Vector3(), normal = new THREE.Vector3(), tangent = new THREE.Vector3(), bit = new THREE.Vector3()

    this.events.forEach((e, i) => {
      latLonToVector3(e.lat, e.lon, 1.004, v)
      normal.copy(v).normalize()
      q.setFromUnitVectors(up, normal)
      const size = 0.06 + e.intensity * 0.22
      s.set(size, size, size)
      m.compose(v, q, s)
      this.rings.setMatrixAt(i, m)
      seeds.setX(i, Math.random())
      ints.setX(i, e.intensity)

      v.toArray(corePos, i * 3)
      coreData[i * 2] = e.intensity
      coreData[i * 2 + 1] = Math.random()
      coreSel[i] = e.id === this.selectedId ? 1 : 0

      tangent.set(0, 1, 0).cross(normal).normalize()
      if (tangent.lengthSq() < 0.01) tangent.set(1, 0, 0)
      bit.copy(normal).cross(tangent)
      const count = Math.round(SPARKS_PER_PIN * (0.3 + e.intensity))
      for (let k = 0; k < count; k++) {
        const ang = Math.random() * Math.PI * 2
        const spread = 0.35 + Math.random() * 0.6
        const dir = normal.clone()
          .addScaledVector(tangent, Math.cos(ang) * spread)
          .addScaledVector(bit, Math.sin(ang) * spread)
          .normalize()
        sparkPos.push(v.x, v.y, v.z)
        sparkDir.push(dir.x, dir.y, dir.z)
        sparkData.push(Math.random(), 0.5 + Math.random() * 0.9, e.intensity)
      }
    })
    this.rings.count = n
    this.rings.instanceMatrix.needsUpdate = true
    seeds.needsUpdate = true
    ints.needsUpdate = true

    const cg = new THREE.BufferGeometry()
    cg.setAttribute('position', new THREE.BufferAttribute(corePos, 3))
    cg.setAttribute('aData', new THREE.BufferAttribute(coreData, 2))
    cg.setAttribute('aSelected', new THREE.BufferAttribute(coreSel, 1))
    this.cores.geometry.dispose()
    this.cores.geometry = cg

    const sg = new THREE.BufferGeometry()
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sparkPos, 3))
    sg.setAttribute('aDir', new THREE.Float32BufferAttribute(sparkDir, 3))
    sg.setAttribute('aData', new THREE.Float32BufferAttribute(sparkData, 3))
    this.sparks.geometry.dispose()
    this.sparks.geometry = sg

    // flares: selecionado primeiro, depois os mais intensos
    const ranked = [...this.events].sort((a, b) =>
      (b.id === this.selectedId ? 10 : b.intensity) - (a.id === this.selectedId ? 10 : a.intensity))
    this.flareAnchors = ranked.slice(0, MAX_FLARES).map((e) => ({
      pos: latLonToVector3(e.lat, e.lon, 1.01),
      strength: e.id === this.selectedId ? 1.3 : 0.4 + e.intensity * 0.6,
    }))
  }

  update(t: number, camera: THREE.Camera, worldScale: number) {
    this.ringMat.uniforms.uTime.value = t
    this.sparkMat.uniforms.uTime.value = t
    this.coreMat.uniforms.uTime.value = t
    const camDir = new THREE.Vector3()
    const world = new THREE.Vector3()
    this.flares.forEach((f, i) => {
      const a = this.flareAnchors[i]
      if (!a || !this.flaresEnabled) { f.visible = false; return }
      world.copy(a.pos).multiplyScalar(worldScale)
      camDir.copy(camera.position).sub(world).normalize()
      const facing = a.pos.clone().normalize().dot(camDir)
      const op = THREE.MathUtils.smoothstep(facing, 0.05, 0.35) * a.strength * 0.7
      f.visible = op > 0.01
      f.position.copy(a.pos)
      f.quaternion.copy(camera.quaternion)
      const dist = camera.position.distanceTo(world)
      const sc = (0.4 + a.strength * 0.35) * dist * 0.11 / worldScale
      f.scale.set(sc * 3, sc, 1)
      const mat = f.material as THREE.ShaderMaterial
      mat.uniforms.uOpacity.value = op
      mat.uniforms.uTime.value = t + i
    })
  }
}
