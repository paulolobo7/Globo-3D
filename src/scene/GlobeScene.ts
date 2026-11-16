import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import GUI from 'lil-gui'
import { EarthMesh } from './EarthMesh'
import { ArcsLayer } from './ArcsLayer'
import { PinsLayer } from './PinsLayer'
import { RingsLayer } from './RingsLayer'
import type { GeoArc, GeoEvent } from '../services/dataService'
import { latLonToVector3 } from '../utils/geo'

const MAX_HOT = 8
const INTRO_VIEW = { lat: 12, lon: -52 } // Atlântico / Brasil de frente

/** Pós-processamento final: aberração cromática espectral + distorção de calor + vinheta + grão. */
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uAberration: { value: 0.9 },
    uHaze: { value: 1.0 },
    uVignette: { value: 0.55 },
    uGrain: { value: 0.015 },
    uAspect: { value: 1 },
    uHot: { value: Array.from({ length: MAX_HOT }, () => new THREE.Vector3()) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uAberration, uHaze, uVignette, uGrain, uAspect;
    uniform vec3 uHot[${MAX_HOT}];
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1,0)), u.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
    }
    // pesos espectrais (vermelho -> violeta) para a aberração "prismática"
    vec3 spectral(float t) {
      return clamp(vec3(
        1.0 - abs(t - 0.15) * 3.2,
        1.0 - abs(t - 0.5) * 3.2,
        1.0 - abs(t - 0.85) * 3.2), 0.0, 1.0);
    }

    void main() {
      vec2 uv = vUv;
      // distorção refrativa de calor perto dos pontos mais ativos
      vec2 offs = vec2(0.0);
      for (int i = 0; i < ${MAX_HOT}; i++) {
        vec3 h = uHot[i];
        if (h.z <= 0.0) continue;
        vec2 d = (uv - h.xy) * vec2(uAspect, 1.0);
        float fall = exp(-dot(d, d) * 260.0) * h.z;
        vec2 n = vec2(noise(uv * 60.0 + vec2(0.0, uTime * 3.0)), noise(uv * 60.0 + vec2(7.3, -uTime * 2.5))) - 0.5;
        offs += n * fall;
      }
      uv += offs * uHaze * 0.012;

      vec2 dir = uv - 0.5;
      float amt = uAberration * 0.018 * dot(dir, dir) * 2.0;
      vec3 acc = vec3(0.0), wsum = vec3(0.0);
      for (int i = 0; i < 7; i++) {
        float t = float(i) / 6.0;
        vec3 w = spectral(t);
        acc += texture2D(tDiffuse, uv - dir * amt * (t - 0.5) * 2.0).rgb * w;
        wsum += w;
      }
      vec3 col = acc / wsum;

      float vig = smoothstep(1.05, 0.25, length(dir * vec2(uAspect, 1.0)) * 1.1);
      col *= mix(1.0, vig, uVignette);
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col += (hash(uv * 1000.0 + uTime) - 0.5) * uGrain * smoothstep(0.0, 0.08, lum);
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
}

export interface SceneStats { fps: number; particles: number; arcs: number; landDots: number }

export class GlobeScene {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly controls: OrbitControls
  readonly root = new THREE.Group()
  readonly earth: EarthMesh
  readonly arcs: ArcsLayer
  readonly pins: PinsLayer
  readonly rings: RingsLayer
  private composer: EffectComposer
  private bloom: UnrealBloomPass
  private finalPass: ShaderPass
  private gui: GUI
  private timer = new THREE.Timer()
  private raf = 0
  private time = 0
  private frames = 0
  private fpsTime = 0
  private fly: { from: THREE.Vector3; to: THREE.Vector3; fromDist: number; toDist: number; t: number; dur: number } | null = null
  private idleUntil = 0
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  onStats?: (s: SceneStats) => void

  readonly params = {
    bloomStrength: 1.6,
    bloomRadius: 0.18,
    bloomThreshold: 0.2,
    aberration: 0.9,
    heatHaze: 1.0,
    vignette: 0.55,
    grain: 0.015,
    exposure: 0.85,
    particleSpeed: 0.32,
    arcSize: 6,
    arcDensity: 1,
    ringSpeed: 1,
    ringBrightness: 1,
    globeScale: 1,
    atmosphere: 0.6,
    iridescence: 0.22,
    dotSize: 2.1,
    autoRotate: 0.35,
  }

  constructor(private container: HTMLElement) {
    const w = container.clientWidth, h = container.clientHeight
    const pr = Math.min(window.devicePixelRatio, 1.75)
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(pr)
    this.renderer.setSize(w, h)
    this.renderer.setClearColor(0x000000, 1)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = this.params.exposure
    container.appendChild(this.renderer.domElement)
    this.scene.background = new THREE.Color(0x000000)

    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.05, 100)
    this.camera.position.set(0, 1.2, 14) // começa longe: animação de entrada
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.05
    this.controls.rotateSpeed = 0.55
    this.controls.zoomSpeed = 0.7
    this.controls.enablePan = false
    this.controls.minDistance = 1.9
    this.controls.maxDistance = 14
    this.controls.autoRotate = !this.reducedMotion
    this.controls.autoRotateSpeed = this.params.autoRotate
    this.controls.addEventListener('start', () => { this.fly = null; this.idleUntil = this.time + 4 })

    // luz ambiente mínima (os materiais são shaders próprios; a luz serve para extensões futuras)
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.05))

    this.earth = new EarthMesh(pr)
    this.arcs = new ArcsLayer(pr)
    this.pins = new PinsLayer(pr)
    this.rings = new RingsLayer(pr)
    this.root.add(this.earth.group, this.rings.group, this.arcs.group, this.pins.group)
    this.root.rotation.z = THREE.MathUtils.degToRad(-8)
    this.scene.add(this.root)
    this.orientDisk(INTRO_VIEW.lat, INTRO_VIEW.lon)

    // pós-processamento
    this.composer = new EffectComposer(this.renderer)
    this.composer.setPixelRatio(pr)
    this.composer.setSize(w, h)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), this.params.bloomStrength, this.params.bloomRadius, this.params.bloomThreshold)
    this.composer.addPass(this.bloom)
    this.finalPass = new ShaderPass(FinalShader)
    this.finalPass.uniforms.uAspect.value = w / h
    this.composer.addPass(this.finalPass)
    this.composer.addPass(new OutputPass())

    // telas em retrato: a cena fica menor e mais densa, então reduz o brilho acumulado
    if (w / h < 0.8) {
      this.params.bloomStrength = 0.9
      this.params.ringBrightness = 0.6
      this.bloom.strength = 0.9
      this.rings.brightness = 0.6
    }
    this.gui = this.buildGui()
    window.addEventListener('resize', this.onResize)
    this.flyIntro()
    this.loop()
  }

  // ------------------------------------------------------------------ API pública

  setEvents(events: GeoEvent[]) { this.pins.setEvents(events) }
  setArcs(arcs: GeoArc[]) { this.arcs.setArcs(arcs) }
  setSelected(id: string | null) { this.pins.setSelected(id) }
  setRingsVisible(v: boolean) { this.rings.group.visible = v }
  setFlares(v: boolean) { this.pins.flaresEnabled = v; this.finalPass.uniforms.uHaze.value = v ? this.params.heatHaze : 0 }
  toggleGui() { this.gui._hidden ? this.gui.show() : this.gui.hide(); return !this.gui._hidden }

  /** Leva a câmera suavemente até lat/lon (interpolação esférica da direção + distância). */
  flyTo(lat: number, lon: number, distance = 3.6) {
    const target = latLonToVector3(lat, lon, 1).applyQuaternion(this.root.quaternion).normalize()
    this.fly = {
      from: this.camera.position.clone().normalize(),
      to: target,
      fromDist: this.camera.position.length(),
      toDist: distance * this.params.globeScale,
      t: 0,
      dur: this.reducedMotion ? 0.01 : 1.8,
    }
    this.idleUntil = this.time + 8
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    window.removeEventListener('resize', this.onResize)
    this.gui.destroy()
    this.controls.dispose()
    this.composer.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  // ------------------------------------------------------------------ interno

  private flyIntro() {
    const start = this.camera.position.clone()
    this.fly = { from: start.clone().normalize(), to: latLonToVector3(INTRO_VIEW.lat, INTRO_VIEW.lon, 1).applyQuaternion(this.root.quaternion).normalize(), fromDist: start.length(), toDist: this.defaultDistance(), t: 0, dur: this.reducedMotion ? 0.01 : 3.2 }
  }

  /** Inclina o disco para ser visto quase de perfil a partir da vista inicial (como na referência). */
  private orientDisk(lat: number, lon: number) {
    const view = latLonToVector3(lat, lon, 1).normalize() // espaço local do root
    const up = new THREE.Vector3(0, 1, 0)
    const upProj = up.clone().addScaledVector(view, -up.dot(view)).normalize()
    const normal = upProj.clone().addScaledVector(view, 0.2).normalize()
    const q = new THREE.Quaternion().setFromUnitVectors(up, normal)
    const roll = new THREE.Quaternion().setFromAxisAngle(view, THREE.MathUtils.degToRad(-24))
    this.rings.streams[0].object.quaternion.copy(roll.multiply(q))
  }

  private defaultDistance() {
    const aspect = this.container.clientWidth / this.container.clientHeight
    return (aspect < 0.8 ? 7.4 : 5.2) * this.params.globeScale // retrato (celular) precisa de mais distância
  }

  private buildGui() {
    const p = this.params
    const gui = new GUI({ title: 'Calibração visual  [G]' })
    const post = gui.addFolder('Pós-processamento')
    post.add(p, 'bloomStrength', 0, 4, 0.01).name('Bloom · força').onChange((v: number) => (this.bloom.strength = v))
    post.add(p, 'bloomRadius', 0, 1.5, 0.01).name('Bloom · raio').onChange((v: number) => (this.bloom.radius = v))
    post.add(p, 'bloomThreshold', 0, 1, 0.005).name('Bloom · limiar').onChange((v: number) => (this.bloom.threshold = v))
    post.add(p, 'aberration', 0, 4, 0.01).name('Aberração cromática').onChange((v: number) => (this.finalPass.uniforms.uAberration.value = v))
    post.add(p, 'heatHaze', 0, 3, 0.01).name('Distorção de calor').onChange((v: number) => (this.finalPass.uniforms.uHaze.value = v))
    post.add(p, 'vignette', 0, 1, 0.01).name('Vinheta').onChange((v: number) => (this.finalPass.uniforms.uVignette.value = v))
    post.add(p, 'grain', 0, 0.15, 0.001).name('Grão').onChange((v: number) => (this.finalPass.uniforms.uGrain.value = v))
    post.add(p, 'exposure', 0.3, 2.5, 0.01).name('Exposição').onChange((v: number) => (this.renderer.toneMappingExposure = v))
    const parts = gui.addFolder('Partículas')
    parts.add(p, 'particleSpeed', 0, 1.5, 0.01).name('Velocidade dos arcos').onChange((v: number) => (this.arcs.uniforms.uSpeed.value = v))
    parts.add(p, 'arcSize', 2, 24, 0.1).name('Tamanho (arcos)').onChange((v: number) => (this.arcs.uniforms.uSize.value = v))
    parts.add(p, 'arcDensity', 0.2, 3, 0.05).name('Densidade (arcos)').onFinishChange((v: number) => { this.arcs.density = v; this.arcs.invalidate() })
    parts.add(p, 'ringSpeed', 0, 4, 0.01).name('Velocidade do disco').onChange((v: number) => (this.rings.speed = v))
    parts.add(p, 'ringBrightness', 0, 3, 0.01).name('Brilho do disco').onChange((v: number) => (this.rings.brightness = v))
    const globe = gui.addFolder('Globo')
    globe.add(p, 'globeScale', 0.5, 1.8, 0.01).name('Escala').onChange((v: number) => this.root.scale.setScalar(v))
    globe.add(p, 'atmosphere', 0, 3, 0.01).name('Atmosfera').onChange((v: number) => (this.earth.atmosphereIntensity = v))
    globe.add(p, 'iridescence', 0, 2, 0.01).name('Iridescência').onChange((v: number) => (this.earth.iridescence = v))
    globe.add(p, 'dotSize', 0.5, 6, 0.05).name('Tamanho dos pontos').onChange((v: number) => (this.earth.dotSize = v))
    globe.add(p, 'autoRotate', 0, 3, 0.01).name('Rotação automática').onChange((v: number) => (this.controls.autoRotateSpeed = v))
    gui.add({ copiar: () => navigator.clipboard?.writeText(JSON.stringify(p, null, 2)) }, 'copiar').name('Copiar valores (JSON)')
    gui.hide()
    return gui
  }

  private onResize = () => {
    const w = this.container.clientWidth, h = this.container.clientHeight
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
    this.composer.setSize(w, h)
    this.bloom.resolution.set(w, h)
    this.finalPass.uniforms.uAspect.value = w / h
  }

  private updateHotspots() {
    const hot = this.finalPass.uniforms.uHot.value as THREE.Vector3[]
    const anchors = [
      ...this.pins.hotspots,
      { pos: new THREE.Vector3(0, 1.02, 0), strength: 0.35 },  // polo norte
      { pos: new THREE.Vector3(0, -1.02, 0), strength: 0.35 }, // polo sul
    ].slice(0, MAX_HOT)
    const world = new THREE.Vector3(), toCam = new THREE.Vector3()
    for (let i = 0; i < MAX_HOT; i++) {
      const a = anchors[i]
      if (!a) { hot[i].set(0, 0, 0); continue }
      world.copy(a.pos).applyMatrix4(this.root.matrixWorld)
      const n = world.clone().normalize()
      toCam.copy(this.camera.position).sub(world).normalize()
      const facing = THREE.MathUtils.smoothstep(n.dot(toCam), 0.0, 0.3)
      world.project(this.camera)
      hot[i].set(world.x * 0.5 + 0.5, world.y * 0.5 + 0.5, a.strength * facing)
    }
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop)
    this.timer.update()
    const dt = Math.min(this.timer.getDelta(), 0.05)
    this.time += dt
    const t = this.time

    if (this.fly) {
      const f = this.fly
      f.t = Math.min(1, f.t + dt / f.dur)
      const e = f.t < 0.5 ? 4 * f.t ** 3 : 1 - (-2 * f.t + 2) ** 3 / 2 // easeInOutCubic
      const dir = slerpVectors(f.from, f.to, e)
      const dist = THREE.MathUtils.lerp(f.fromDist, f.toDist, e)
      this.camera.position.copy(dir.multiplyScalar(dist))
      this.camera.lookAt(0, 0, 0)
      if (f.t >= 1) this.fly = null
    }
    this.controls.autoRotate = !this.reducedMotion && !this.fly && t > this.idleUntil
    this.controls.update()

    this.earth.update(t)
    this.rings.update(this.reducedMotion ? dt * 0.15 : dt)
    this.arcs.update(t)
    this.root.updateMatrixWorld()
    this.pins.update(t, this.camera, this.params.globeScale)
    this.updateHotspots()
    this.finalPass.uniforms.uTime.value = t
    this.composer.render(dt)

    this.frames++
    if (t - this.fpsTime > 0.5) {
      const fps = this.frames / (t - this.fpsTime)
      this.frames = 0
      this.fpsTime = t
      this.onStats?.({
        fps,
        particles: this.arcs.particleCount + this.rings.particleCount + this.earth.landDotCount,
        arcs: this.arcs.activeCount,
        landDots: this.earth.landDotCount,
      })
    }
  }
}

function slerpVectors(a: THREE.Vector3, b: THREE.Vector3, t: number) {
  const dot = THREE.MathUtils.clamp(a.dot(b), -1, 1)
  const theta = Math.acos(dot) * t
  const rel = b.clone().sub(a.clone().multiplyScalar(dot))
  if (rel.lengthSq() < 1e-8) return a.clone()
  rel.normalize()
  return a.clone().multiplyScalar(Math.cos(theta)).add(rel.multiplyScalar(Math.sin(theta)))
}
