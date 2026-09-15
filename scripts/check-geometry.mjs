import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';

// Exercise the actual Voronoi mesh builder without needing a GPU context.
const source = readFileSync(new URL('../lib/toy.ts', import.meta.url), 'utf8');
const body = source.slice(
  source.indexOf('function frostGeometry()'),
  source.indexOf('const deformation'),
);
const compiled = ts.transpileModule(body, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const geometry = new Function(
  'THREE',
  'ConvexGeometry',
  `${compiled}\nreturn frostGeometry();`,
)(THREE, ConvexGeometry);
const p = geometry.getAttribute('position');
const cell = geometry.getAttribute('aCell');
assert(p.count > 10000);
assert.equal(cell.count, p.count);
for (const attr of Object.values(geometry.attributes))
  assert([...attr.array].every(Number.isFinite));
let inward = 0;
const cells = new Set();
for (let i = 0; i < p.count; i += 3) {
  const a = new THREE.Vector3().fromBufferAttribute(p, i);
  const b = new THREE.Vector3().fromBufferAttribute(p, i + 1);
  const c = new THREE.Vector3().fromBufferAttribute(p, i + 2);
  assert(Math.abs(a.length() - 1) < 0.00001);
  const cross = b.sub(a).cross(c.sub(a));
  assert(cross.length() > 0.000001, 'degenerate surface triangle');
  if (cross.dot(a) <= 0) inward++;
  cells.add([cell.getX(i), cell.getY(i), cell.getZ(i)].join(','));
}
assert.equal(inward, 0, 'all surfaces must face outward');
assert.equal(cells.size, 115, 'expected connected irregular frost plates');
geometry.dispose();
console.log(
  `PASS: ${cells.size} frost plates; ${p.count / 3} outward triangles; finite attributes.`,
);
