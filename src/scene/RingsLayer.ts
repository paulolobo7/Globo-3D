import * as THREE from 'three'

/**
 * "Disco de acreção": fluxos de partículas orbitando o globo, com rastro, velocidade
 * kepleriana (mais rápido por dentro), beaming Doppler e franjas cromáticas nas bordas.
 */
const vertex = /* glsl */ `
  uniform float uTime;
  uniform float uSpeed;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform float uTrailLen;
  uniform float uInner;
  uniform float uOuter;
  attribute vec4 aOrbit;  // raio, ângulo inicial, altura, seed
  attribute float aTrail; // 0 = cabeça, 1 = fim do rastro
  varying float vR;
  varying float vSeed;
  varying float vTrail;
  varying float vBeam;
  void main() {
    float r = aOrbit.x;
    float omega = uSpeed / pow(r, 1.5);
    float ang = aOrbit.y + uTime * omega - aTrail * uTrailLen * omega;
    float rr = r * (1.0 + 0.04 * sin(2.0 * ang + aOrbit.w * 6.0));
    vec3 p = vec3(cos(ang) * rr, aOrbit.z, sin(ang) * rr);
    vec3 vel = normalize(vec3(-sin(ang), 0.0, cos(ang)));

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vec3 velView = normalize(mat3(modelViewMatrix) * vel);
    vBeam = 1.0 + 0.85 * dot(velView, normalize(-mv.xyz)); // lado que vem em direção à câmera brilha mais
    vR = (r - uInner) / (uOuter - uInner);
    vSeed = aOrbit.w;
    vTrail = aTrail;
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uPixelRatio * (0.6 + pow(aOrbit.w, 8.0) * 2.5) / -mv.z;
  }
`
const fragment = /* glsl */ `
  uniform float uBrightness;
  varying float vR;
  varying float vSeed;
  varying float vTrail;
  varying float vBeam;
  uniform float uIsPoints;
  void main() {
    float d = 0.0;
    if (uIsPoints > 0.5) { d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; }
    // interior branco-dourado -> laranja -> vermelho; bordas com franja azul (dispersão)
    vec3 c = mix(vec3(1.0, 0.8, 0.5), vec3(1.0, 0.38, 0.05), smoothstep(0.03, 0.3, vR));
    c = mix(c, vec3(0.95, 0.2, 0.06), smoothstep(0.45, 0.85, vR));
    float fringe = smoothstep(0.1, 0.0, vR) + smoothstep(0.88, 1.0, vR);
    c = mix(c, vec3(0.2, 0.5, 1.0), clamp(fringe, 0.0, 1.0) * 0.9);
    c = mix(c, vec3(0.3, 0.7, 1.0), step(0.93, vSeed) * 0.7); // partículas frias espalhadas
    float density = smoothstep(0.0, 0.12, vR) * (1.0 - smoothstep(0.75, 1.0, vR)) * 0.8 + 0.2;
    float a = (uIsPoints > 0.5 ? smoothstep(0.5, 0.0, d) : pow(1.0 - vTrail, 1.6)) * density;
    gl_FragColor = vec4(c * uBrightness * vBeam, a);
  }
`

export interface RingOptions {
  count: number
  inner: number
  outer: number
  thickness: number
  /** segmentos de linha por rastro */
  trail: number
  trailLen: number
  speed: number
  size: number
  brightness: number
}

export class RingStream {
  readonly object: THREE.Object3D
  readonly materials: THREE.ShaderMaterial[] = []
  readonly lineCount: number

  constructor(opts: RingOptions, pixelRatio: number) {
    const { count, inner, outer, thickness, trail } = opts
    // linhas: cada rastro é uma polilinha de `trail` segmentos (2 vértices por segmento)
    const nv = count * trail * 2
    const orbit = new Float32Array(nv * 4)
    const trailAttr = new Float32Array(nv)
    const heads = new Float32Array(count * 4)
    for (let i = 0; i < count; i++) {
      const u = Math.pow(Math.random(), 1.8) // mais densidade perto da borda interna
      const r = inner + u * (outer - inner)
      const ang = Math.random() * Math.PI * 2
      const h = (Math.random() - 0.5) * thickness * (0.4 + u)
      const seed = Math.random()
      heads.set([r, ang, h, seed], i * 4)
      for (let k = 0; k < trail; k++) {
        for (let e = 0; e < 2; e++) {
          const idx = (i * trail + k) * 2 + e
          orbit.set([r, ang, h, seed], idx * 4)
          trailAttr[idx] = (k + e) / trail
        }
      }
    }
    const mk = (isPoints: boolean) =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uSpeed: { value: opts.speed },
          uSize: { value: opts.size },
          uPixelRatio: { value: pixelRatio },
          uTrailLen: { value: opts.trailLen },
          uInner: { value: inner },
          uOuter: { value: outer },
          uBrightness: { value: opts.brightness * (isPoints ? 1.6 : 1) },
          uIsPoints: { value: isPoints ? 1 : 0 },
        },
      })
    const lg = new THREE.BufferGeometry()
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3))
    lg.setAttribute('aOrbit', new THREE.BufferAttribute(orbit, 4))
    lg.setAttribute('aTrail', new THREE.BufferAttribute(trailAttr, 1))
    const lineMat = mk(false)
    lineMat.userData.base = lineMat.uniforms.uBrightness.value
    const lines = new THREE.LineSegments(lg, lineMat)
    lines.frustumCulled = false

    const pg = new THREE.BufferGeometry()
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    pg.setAttribute('aOrbit', new THREE.BufferAttribute(heads, 4))
    pg.setAttribute('aTrail', new THREE.BufferAttribute(new Float32Array(count), 1))
    const pointMat = mk(true)
    pointMat.userData.base = pointMat.uniforms.uBrightness.value
    const points = new THREE.Points(pg, pointMat)
    points.frustumCulled = false

    this.materials.push(lineMat, pointMat)
    this.lineCount = count
    this.object = new THREE.Group()
    this.object.add(lines, points)
  }
}

export class RingsLayer {
  readonly group = new THREE.Group()
  readonly streams: RingStream[] = []
  speed = 1

  constructor(pixelRatio: number) {
    // disco principal inclinado
    const disk = new RingStream(
      { count: 6000, inner: 1.4, outer: 2.6, thickness: 0.06, trail: 4, trailLen: 2.6, speed: 0.55, size: 4, brightness: 0.06 },
      pixelRatio,
    )
    disk.object.rotation.set(THREE.MathUtils.degToRad(14), 0, THREE.MathUtils.degToRad(-26))
    this.add(disk)

    // fluxos secundários em órbitas inclinadas (os "laços" da referência)
    const tilts: [number, number, number, number][] = [
      [62, 38, 1.5, 1.62],
      [-48, -64, 1.75, 1.86],
      [96, 20, 1.22, 1.3],
    ]
    for (const [rx, rz, a, b] of tilts) {
      const s = new RingStream(
        { count: 260, inner: a, outer: b, thickness: 0.01, trail: 4, trailLen: 3, speed: 0.75, size: 3, brightness: 0.12 },
        pixelRatio,
      )
      s.object.rotation.set(THREE.MathUtils.degToRad(rx), 0, THREE.MathUtils.degToRad(rz))
      this.add(s)
    }
  }

  private add(s: RingStream) {
    this.streams.push(s)
    this.group.add(s.object)
  }

  get particleCount() {
    return this.streams.reduce((n, s) => n + s.lineCount, 0)
  }

  private get mats() { return this.streams.flatMap((s) => s.materials) }
  setPixelRatio(pr: number) { this.mats.forEach((m) => (m.uniforms.uPixelRatio.value = pr)) }
  private _brightness = 1
  set brightness(v: number) { this._brightness = v; this.mats.forEach((m) => (m.uniforms.uBrightness.value = m.userData.base * v)) }
  get brightness() { return this._brightness }

  update(dt: number) {
    for (const m of this.mats) {
      m.uniforms.uTime.value += dt * this.speed
    }
  }
}
