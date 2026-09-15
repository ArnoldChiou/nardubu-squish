import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as THREE from 'three';

const source = readFileSync(new URL('../lib/plastic-body.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText.replace(/from '([^']+)'/g, (_, name) => `from '${import.meta.resolve(name)}'`);
const { PlasticBody } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const body = new PlasticBody();
assert.equal(body.positions.length, 162);
assert.equal(body.triangles.length / 3, 320);
assert(body.volume0 > 0);
const initial = body.positions.map((p) => p.toArray());
const front = new THREE.Vector3(0.25, 0.15, 1);
const binding = body.bind(front);
const grip = { point: front, normal: front.clone().normalize(), drag: new THREE.Vector3(-0.16, -0.1, 0), depth: 0 };
const t0 = performance.now();
body.begin();
for (let i = 0; i < 216; i++) {
  grip.depth = Math.min(0.56, i / 120 * 0.46);
  body.step(1 / 120, [grip]);
}
const moved = body.sample(binding, new THREE.Vector3());
assert(moved.z < front.z - 0.10, 'press must produce a local dent');
assert(moved.x < front.x - 0.02, 'drag direction must matter');
assert(body.positions.some((p, i) => p.length() > body.rest[i].length() + 0.015), 'a dent must redistribute into a bulge');
assert(body.damage.some((v) => v > 0.01), 'strain must permanently fracture material');
assert(body.damage.some((v) => v < 0.001), 'undisturbed regions must not break globally');
const ratio = body.volume() / body.volume0;
assert(Math.abs(ratio - 1) < 0.03, `volume drift ${ratio}`);
body.release();
const retained = body.positions.map((p) => p.toArray());
const damage = Array.from(body.damage);
for (let i = 0; i < 1200; i++) body.step(1 / 120, []);
assert.deepEqual(body.positions.map((p) => p.toArray()), retained, 'release must not restore the shape');
assert.deepEqual(Array.from(body.damage), damage, 'cracks must not heal');
body.begin();
const second = { ...grip, point: moved.clone(), depth: 0.3, drag: new THREE.Vector3(0.18, 0.04, 0) };
for (let i = 0; i < 120; i++) body.step(1 / 120, [second]);
body.release();
assert.notDeepEqual(body.positions.map((p) => p.toArray()), retained, 'new squeeze must build on the old deformation');
assert(body.damage.every((v, i) => v >= damage[i]), 'damage must be monotonic');

// Two opposing fingers, then repeated kneading on the current (not neutral) skin.
for (let pass = 0; pass < 24; pass++) {
  body.begin();
  const a = pass * 2.3999;
  const direction = new THREE.Vector3(Math.cos(a), Math.sin(a) * 0.4, 1).normalize();
  const point = body.sample(body.bind(direction.clone().multiply(new THREE.Vector3(1.3, 0.88, 1.02))), new THREE.Vector3());
  const grips = [{ point, normal: direction, depth: 0.28, drag: new THREE.Vector3(0.05 * Math.sin(a), -0.04, 0) }];
  if (pass % 2 === 0) {
    const opposite = direction.clone().negate();
    grips.push({ point: body.sample(body.bind(opposite.clone().multiply(new THREE.Vector3(1.3, 0.88, 1.02))), new THREE.Vector3()), normal: opposite, depth: 0.2, drag: new THREE.Vector3() });
  }
  for (let i = 0; i < 90; i++) body.step(1 / 120, grips);
  body.release();
  assert(body.positions.every((p) => p.toArray().every(Number.isFinite)), 'finite after repeated kneading');
  assert(body.positions.every((p) => p.length() < 4), 'bounded after repeated kneading');
  assert(Math.abs(body.volume() / body.volume0 - 1) < 0.04, 'volume remains stable');
}
body.reset();
assert.deepEqual(body.positions.map((p) => p.toArray()), initial, 'manual reset restores every particle');
assert(body.damage.every((v) => v === 0), 'manual reset clears fracture');
console.log(`PASS: ${body.positions.length} particles, ${body.edges.length} constraints; local dent + directed drag + permanent damage + no rebound + 24 repeated/multi-grip trials + reset. Volume ratio ${ratio.toFixed(4)}. ${Math.round(performance.now() - t0)} ms.`);
