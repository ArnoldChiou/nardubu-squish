import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export type Grip = {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  drag: THREE.Vector3;
  depth: number;
};
type Edge = { a: number; b: number; length: number; lambda: number };
export type Binding = { indices: number[]; weights: number[]; rest: THREE.Vector3 };

/** Small XPBD surface cage: distance + volume constraints, yielding rest lengths.
 * A tactile approximation, not a calibrated FEM/material-identification model.
 * Unloading latches the final configuration; no force pulls it back to a sphere.
 */
export class PlasticBody {
  readonly rest: THREE.Vector3[];
  readonly positions: THREE.Vector3[];
  readonly damage: Float64Array;
  readonly triangles: number[];
  readonly edges: Edge[] = [];
  readonly volume0: number;
  private snapshot: THREE.Vector3[];
  private previous: THREE.Vector3[];
  private velocities: THREE.Vector3[];
  private gradients: THREE.Vector3[];
  private volumeLambda = 0;
  active = false;
  movement = 0;
  broken = 0;

  constructor() {
    const raw = new THREE.IcosahedronGeometry(1, 3);
    raw.deleteAttribute('normal');
    raw.deleteAttribute('uv');
    const geometry = mergeVertices(raw, 1e-5);
    const p = geometry.getAttribute('position');
    this.rest = Array.from({ length: p.count }, (_, i) =>
      new THREE.Vector3().fromBufferAttribute(p, i).multiply(new THREE.Vector3(1.30, 0.88, 1.02)),
    );
    this.positions = this.rest.map((v) => v.clone());
    this.snapshot = this.rest.map((v) => v.clone());
    this.previous = this.rest.map((v) => v.clone());
    this.velocities = this.rest.map(() => new THREE.Vector3());
    this.gradients = this.rest.map(() => new THREE.Vector3());
    this.damage = new Float64Array(p.count);
    this.triangles = Array.from(geometry.index!.array);
    const seen = new Set<string>();
    for (let i = 0; i < this.triangles.length; i += 3) {
      const [a, b, c] = this.triangles.slice(i, i + 3);
      for (const [u, v] of [[a, b], [b, c], [c, a]]) {
        const key = `${Math.min(u, v)}:${Math.max(u, v)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        this.edges.push({ a: u, b: v, length: this.rest[u].distanceTo(this.rest[v]), lambda: 0 });
      }
    }
    this.volume0 = this.volume();
    raw.dispose();
    geometry.dispose();
  }

  volume() {
    let volume = 0;
    const cross = new THREE.Vector3();
    for (let i = 0; i < this.triangles.length; i += 3) {
      const a = this.positions[this.triangles[i]], b = this.positions[this.triangles[i + 1]], c = this.positions[this.triangles[i + 2]];
      volume += a.dot(cross.crossVectors(b, c)) / 6;
    }
    return volume;
  }

  begin() {
    this.active = true;
    this.snapshot.forEach((v, i) => v.copy(this.positions[i]));
    this.velocities.forEach((v) => v.set(0, 0, 0));
  }

  release() {
    this.active = false;
    this.movement = 0;
    this.velocities.forEach((v) => v.set(0, 0, 0));
    // The material remembers its unloaded shape, including sub-yield dents.
    this.edges.forEach((e) => { e.length = this.positions[e.a].distanceTo(this.positions[e.b]); });
  }

  reset() {
    this.positions.forEach((p, i) => p.copy(this.rest[i]));
    this.snapshot.forEach((p, i) => p.copy(this.rest[i]));
    this.damage.fill(0);
    this.broken = 0;
    this.release();
  }

  step(dt: number, grips: Grip[]) {
    if (!this.active || !grips.length || dt <= 0) return;
    // Called at fixed 120 Hz by the controller, independent of display refresh.
    const h = Math.min(dt, 1 / 60);
    this.previous.forEach((p, i) => p.copy(this.positions[i]));
    this.positions.forEach((p, i) => p.addScaledVector(this.velocities[i], h * 0.72));
    this.edges.forEach((e) => { e.lambda = 0; });
    this.volumeLambda = 0;
    const delta = new THREE.Vector3(), cross = new THREE.Vector3();
    const goal = new THREE.Vector3();
    // Overlapping finger patches are normalized to avoid order-dependent fights.
    const targets = this.snapshot.map((p) => {
      const displacement = new THREE.Vector3();
      let total = 0;
      for (const grip of grips) {
        const d2 = p.distanceToSquared(grip.point);
        const weight = Math.exp(-d2 / 0.27);
        displacement.addScaledVector(grip.drag, weight);
        displacement.addScaledVector(grip.normal, -grip.depth * weight);
        total += weight;
      }
      if (total > 1) displacement.divideScalar(total);
      return { goal: p.clone().add(displacement), weight: Math.min(1, total) };
    });
    for (let iteration = 0; iteration < 7; iteration++) {
      for (const e of this.edges) {
        const a = this.positions[e.a], b = this.positions[e.b];
        delta.subVectors(b, a);
        const length = delta.length();
        if (length < 1e-8) continue;
        const softness = 1 + (this.damage[e.a] + this.damage[e.b]) * 2;
        const alpha = 0.000018 * softness / (h * h);
        const dl = (-(length - e.length) - alpha * e.lambda) / (2 + alpha);
        e.lambda += dl;
        delta.multiplyScalar(dl / length);
        a.sub(delta); b.add(delta);
      }
      for (let i = 0; i < this.positions.length; i++) {
        goal.copy(targets[i].goal).sub(this.positions[i]);
        this.positions[i].addScaledVector(goal, targets[i].weight * 0.26);
      }
      // Near-incompressibility redistributes a dent into neighboring bulges.
      this.gradients.forEach((g) => g.set(0, 0, 0));
      for (let i = 0; i < this.triangles.length; i += 3) {
        const [ia, ib, ic] = this.triangles.slice(i, i + 3);
        const a = this.positions[ia], b = this.positions[ib], c = this.positions[ic];
        this.gradients[ia].add(cross.crossVectors(b, c).multiplyScalar(1 / 6));
        this.gradients[ib].add(cross.crossVectors(c, a).multiplyScalar(1 / 6));
        this.gradients[ic].add(cross.crossVectors(a, b).multiplyScalar(1 / 6));
      }
      const denominator = this.gradients.reduce((n, g) => n + g.lengthSq(), 0);
      const alpha = 0.000001 / (h * h);
      const dl = (-(this.volume() - this.volume0) - alpha * this.volumeLambda) / (denominator + alpha);
      this.volumeLambda += dl;
      this.positions.forEach((p, i) => p.addScaledVector(this.gradients[i], dl));
    }
    const before = this.damage.reduce((n, d) => n + d, 0);
    // Irreversible creep above yield. Rest lengths change, not just animation time.
    for (const e of this.edges) {
      const length = this.positions[e.a].distanceTo(this.positions[e.b]);
      const strain = Math.abs(length / Math.max(e.length, 0.001) - 1);
      if (strain > 0.035) {
        e.length += (length - e.length) * (1 - Math.exp(-h * 6));
        const increment = Math.max(0, strain - 0.055) * h * 3;
        this.damage[e.a] = Math.min(1, this.damage[e.a] + increment);
        this.damage[e.b] = Math.min(1, this.damage[e.b] + increment);
      }
    }
    this.broken = Math.max(0, this.damage.reduce((n, d) => n + d, 0) - before);
    this.movement = 0;
    this.positions.forEach((p, i) => {
      this.velocities[i].subVectors(p, this.previous[i]).divideScalar(h);
      this.velocities[i].clampLength(0, 2);
      this.movement += p.distanceTo(this.previous[i]);
    });
    this.movement /= this.positions.length * h;
  }

  bind(point: THREE.Vector3): Binding {
    // Smooth cage displacement interpolation; preserves the high-resolution skin.
    const nearest = this.rest.map((p, i) => ({ i, d: p.distanceToSquared(point) }))
      .sort((a, b) => a.d - b.d).slice(0, 8);
    const raw = nearest.map(({ d }) => 1 / Math.pow(d + 0.055, 2));
    const sum = raw.reduce((a, b) => a + b, 0);
    return { indices: nearest.map(({ i }) => i), weights: raw.map((v) => v / sum), rest: point.clone() };
  }

  sample(binding: Binding, out: THREE.Vector3) {
    out.copy(binding.rest);
    for (let j = 0; j < binding.indices.length; j++) {
      const i = binding.indices[j], w = binding.weights[j];
      out.x += (this.positions[i].x - this.rest[i].x) * w;
      out.y += (this.positions[i].y - this.rest[i].y) * w;
      out.z += (this.positions[i].z - this.rest[i].z) * w;
    }
    return out;
  }

  damageAt(binding: Binding) {
    return binding.indices.reduce((d, i, j) => d + this.damage[i] * binding.weights[j], 0);
  }
}
