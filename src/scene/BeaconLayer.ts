import * as THREE from 'three'
import { latLonToVector3 } from '../utils/geo'

/**
 * Farol do local buscado: feixe de luz vertical, anel que pulsa na superfície
 * e uma mira que se fecha quando a câmera chega.
 */
const beamVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`
const beamFragment = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
    float core = pow(across, 6.0);
    float fade = pow(1.0 - vUv.y, 1.4);
    float flow = 0.7 + 0.3 * sin(vUv.y * 40.0 - uTime * 8.0);
    vec3 col = mix(vec3(0.3, 0.65, 1.0), vec3(1.0), core);
    gl_FragColor = vec4(col * core * fade * flow * uOpacity * 2.0, 1.0);
  }
`
const ringFragment = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  uniform float uLock;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    if (r > 1.0) discard;
    vec3 col = vec3(0.0);
    for (int i = 0; i < 3; i++) {
      float w = fract(uTime * 0.6 + float(i) / 3.0);
      col += vec3(0.35, 0.7, 1.0) * smoothstep(0.05, 0.0, abs(r - w)) * (1.0 - w);
    }
    // mira: anel fino com 4 marcas que se fecham (uLock 0 -> 1)
    float target = mix(0.95, 0.38, uLock);
    float ring = smoothstep(0.025, 0.0, abs(r - target));
    float ang = atan(p.y, p.x);
    float ticks = step(0.92, abs(cos(ang * 2.0))) * smoothstep(0.12, 0.0, abs(r - target - 0.08));
    col += vec3(1.0, 0.85, 0.6) * (ring * 0.9 + ticks);
    col += vec3(1.0) * smoothstep(0.08, 0.0, r);
    gl_FragColor = vec4(col * uOpacity, 1.0);
  }
`

export class BeaconLayer {
  readonly group = new THREE.Group()
  private beam: THREE.Mesh
  private ring: THREE.Mesh
  private beamMat: THREE.ShaderMaterial
  private ringMat: THREE.ShaderMaterial
  private born = -1
  private clock = 0

  constructor() {
    const common = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }
    this.beamMat = new THREE.ShaderMaterial({ ...common, vertexShader: beamVertex, fragmentShader: beamFragment, uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 } } })
    this.ringMat = new THREE.ShaderMaterial({ ...common, vertexShader: beamVertex, fragmentShader: ringFragment, uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uLock: { value: 0 } } })

    // feixe: dois planos cruzados, base na superfície, apontando para fora
    const beamGeo = new THREE.PlaneGeometry(0.035, 0.55)
    beamGeo.translate(0, 0.275, 0)
    beamGeo.rotateX(Math.PI / 2) // eixo do feixe = +Z local
    this.beam = new THREE.Mesh(beamGeo, this.beamMat)
    const beam2 = this.beam.clone()
    beam2.rotation.z = Math.PI / 2
    this.beam.add(beam2)
    this.ring = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), this.ringMat)
    this.group.add(this.beam, this.ring)
    this.group.visible = false
  }

  show(lat: number, lon: number) {
    const p = latLonToVector3(lat, lon, 1.004)
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), p.clone().normalize())
    this.group.position.copy(p)
    this.group.quaternion.copy(q)
    this.group.visible = true
    this.born = this.clock
  }

  hide() { this.born = -1; this.group.visible = false }

  update(t: number) {
    this.clock = t
    if (this.born < 0) return
    const age = t - this.born
    const fadeIn = THREE.MathUtils.smoothstep(age, 0.3, 1.2)
    const fadeOut = 1 - THREE.MathUtils.smoothstep(age, 14, 16)
    const op = fadeIn * fadeOut
    if (op <= 0 && age > 16) { this.hide(); return }
    this.beamMat.uniforms.uTime.value = t
    this.ringMat.uniforms.uTime.value = t
    this.beamMat.uniforms.uOpacity.value = op
    this.ringMat.uniforms.uOpacity.value = op
    this.ringMat.uniforms.uLock.value = THREE.MathUtils.smoothstep(age, 1.6, 3.0)
  }
}
