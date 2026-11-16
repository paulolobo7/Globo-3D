import * as THREE from 'three'
import type { GeoArc } from '../services/dataService'
import { arcControlPoints, latLonToVector3 } from '../utils/geo'

/**
 * Arcos de dados: cada arco é uma Bézier cúbica feita de centenas de partículas.
 * A posição é calculada na GPU (vertex shader), então milhares de partículas custam quase nada.
 */
const vertex = /* glsl */ `
  uniform float uTime;
  uniform float uSpeed;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform float uSpread;
  attribute vec3 aP0;
  attribute vec3 aP1;
  attribute vec3 aP2;
  attribute vec3 aP3;
  attribute vec4 aParams;   // offset, velocidade, seed, peso
  attribute vec2 aLife;     // nascimento, morte (relógio da cena; morte < 0 = vivo)
  varying float vT;
  varying float vSeed;
  varying float vAlpha;
  varying float vWeight;

  vec3 bezier(float t) {
    float u = 1.0 - t;
    return u*u*u*aP0 + 3.0*u*u*t*aP1 + 3.0*u*t*t*aP2 + t*t*t*aP3;
  }
  vec3 bezierTangent(float t) {
    float u = 1.0 - t;
    return 3.0*u*u*(aP1-aP0) + 6.0*u*t*(aP2-aP1) + 3.0*t*t*(aP3-aP2);
  }

  void main() {
    float offset = aParams.x, speed = aParams.y, seed = aParams.z, weight = aParams.w;
    float t = fract(offset + uTime * uSpeed * speed);
    // aceleração: começa lento no ponto A e dispara até o B
    float te = pow(t, 1.65);
    vec3 p = bezier(te);
    vec3 tan = normalize(bezierTangent(te));
    vec3 side = normalize(cross(tan, normalize(p)));
    // fita com largura: o lado da fita define a cor (dispersão prismática)
    float lateral = (seed - 0.5) * 2.0;
    float envelope = sin(3.14159 * te);
    p += side * lateral * uSpread * envelope * (0.4 + weight);
    p += normalize(p) * (fract(seed * 91.7) - 0.5) * uSpread * 0.6 * envelope;

    vT = te; vSeed = seed; vWeight = weight;
    float born = smoothstep(aLife.x, aLife.x + 1.2, uTime);
    float dead = aLife.y < 0.0 ? 1.0 : 1.0 - smoothstep(aLife.y, aLife.y + 1.2, uTime);
    vAlpha = born * dead * smoothstep(0.0, 0.06, te) * (1.0 - smoothstep(0.9, 1.0, te));

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float head = pow(fract(seed * 13.3), 6.0) * 2.6; // poucas partículas "cabeça" maiores
    gl_PointSize = uSize * uPixelRatio * (0.55 + head) * (0.6 + weight * 0.8) / -mv.z;
  }
`
const fragment = /* glsl */ `
  uniform float uBrightness;
  varying float vT;
  varying float vSeed;
  varying float vAlpha;
  varying float vWeight;
  vec3 fire(float t) {
    // fogo -> ouro -> branco -> azul cósmico
    vec3 c = mix(vec3(1.0, 0.18, 0.04), vec3(1.0, 0.62, 0.12), smoothstep(0.0, 0.3, t));
    c = mix(c, vec3(1.0, 0.95, 0.85), smoothstep(0.3, 0.6, t));
    c = mix(c, vec3(0.25, 0.65, 1.0), smoothstep(0.65, 0.95, t));
    return c;
  }
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.0, d);
    vec3 col = fire(vT);
    // franja cromática: borda vermelha de um lado, azul do outro
    float edge = (vSeed - 0.5) * 2.0;
    col = mix(col, vec3(1.0, 0.1, 0.25), smoothstep(0.55, 1.0, edge) * 0.8);
    col = mix(col, vec3(0.1, 0.45, 1.0), smoothstep(0.55, 1.0, -edge) * 0.8);
    gl_FragColor = vec4(col * uBrightness * (0.6 + vWeight), a * vAlpha);
  }
`

interface ArcState { arc: GeoArc; born: number; death: number }

export class ArcsLayer {
  readonly group = new THREE.Group()
  private points: THREE.Points
  private lines = new THREE.Group()
  private material: THREE.ShaderMaterial
  private lineMaterial: THREE.LineBasicMaterial
  private arcs = new Map<string, ArcState>()
  private dirty = false
  private clock = 0
  density = 1
  particleCount = 0

  constructor(pixelRatio: number) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uSpeed: { value: 0.32 },
        uSize: { value: 6 },
        uPixelRatio: { value: pixelRatio },
        uSpread: { value: 0.012 },
        uBrightness: { value: 0.3 },
      },
    })
    this.points = new THREE.Points(new THREE.BufferGeometry(), this.material)
    this.points.frustumCulled = false
    this.lineMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    this.group.add(this.lines, this.points)
  }

  get uniforms() { return this.material.uniforms }
  setPixelRatio(pr: number) { this.material.uniforms.uPixelRatio.value = pr }

  /** Sincroniza com a lista atual: arcos novos nascem, ausentes morrem com fade-out. */
  setArcs(list: GeoArc[]) {
    const ids = new Set(list.map((a) => a.id))
    for (const a of list) {
      if (!this.arcs.has(a.id)) {
        this.arcs.set(a.id, { arc: a, born: this.clock, death: -1 })
        this.dirty = true
      }
    }
    for (const [id, s] of this.arcs) {
      if (!ids.has(id) && s.death < 0) {
        s.death = this.clock
        this.dirty = true
      }
    }
  }

  get activeCount() {
    let n = 0
    for (const s of this.arcs.values()) if (s.death < 0) n++
    return n
  }

  private rebuild() {
    let total = 0
    const perArc: number[] = []
    for (const s of this.arcs.values()) {
      const count = Math.round((220 + s.arc.weight * 800) * this.density)
      perArc.push(count)
      total += count
    }
    const P0 = new Float32Array(total * 3), P1 = new Float32Array(total * 3)
    const P2 = new Float32Array(total * 3), P3 = new Float32Array(total * 3)
    const params = new Float32Array(total * 4), life = new Float32Array(total * 2)
    const position = new Float32Array(total * 3) // não usado pelo shader, mas exigido pelo three

    this.lines.children.forEach((l) => (l as THREE.Line).geometry.dispose())
    this.lines.clear()

    let i = 0, k = 0
    const a = new THREE.Vector3(), b = new THREE.Vector3()
    for (const s of this.arcs.values()) {
      latLonToVector3(s.arc.from.lat, s.arc.from.lon, 1.003, a)
      latLonToVector3(s.arc.to.lat, s.arc.to.lon, 1.003, b)
      const [c0, c1, c2, c3] = arcControlPoints(a, b)
      const speed = 0.6 + s.arc.weight * 0.9
      for (let j = 0; j < perArc[k]; j++, i++) {
        c0.toArray(P0, i * 3); c1.toArray(P1, i * 3); c2.toArray(P2, i * 3); c3.toArray(P3, i * 3)
        params.set([Math.random(), speed * (0.85 + Math.random() * 0.3), Math.random(), s.arc.weight], i * 4)
        life.set([s.born, s.death], i * 2)
      }
      k++
      // trilha fina e estática sob as partículas
      if (s.death < 0) {
        const curve = new THREE.CubicBezierCurve3(c0, c1, c2, c3)
        const pts = curve.getPoints(64)
        const g = new THREE.BufferGeometry().setFromPoints(pts)
        const colors = new Float32Array(pts.length * 3)
        pts.forEach((_, idx) => {
          const t = idx / (pts.length - 1)
          const c = new THREE.Color().setHSL(0.07 + t * 0.5, 1, 0.55)
          c.toArray(colors, idx * 3)
        })
        g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
        this.lines.add(new THREE.Line(g, this.lineMaterial))
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(position, 3))
    g.setAttribute('aP0', new THREE.BufferAttribute(P0, 3))
    g.setAttribute('aP1', new THREE.BufferAttribute(P1, 3))
    g.setAttribute('aP2', new THREE.BufferAttribute(P2, 3))
    g.setAttribute('aP3', new THREE.BufferAttribute(P3, 3))
    g.setAttribute('aParams', new THREE.BufferAttribute(params, 4))
    g.setAttribute('aLife', new THREE.BufferAttribute(life, 2))
    this.points.geometry.dispose()
    this.points.geometry = g
    this.particleCount = total
    this.dirty = false
  }

  /** Força reconstrução (ex.: mudou a densidade no painel). */
  invalidate() { this.dirty = true }

  update(t: number) {
    this.clock = t
    this.material.uniforms.uTime.value = t
    // remove arcos cujo fade-out terminou
    for (const [id, s] of this.arcs) {
      if (s.death >= 0 && t > s.death + 1.4) {
        this.arcs.delete(id)
        this.dirty = true
      }
    }
    if (this.dirty) this.rebuild()
  }
}
