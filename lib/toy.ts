import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { CrunchAudio } from './crunch-audio';
import { PlasticBody, type Binding, type Grip } from './plastic-body';
import { fracturePose } from './fracture';

export interface ToyController {
  setSound(enabled: boolean): void;
  squeeze(strength?: number): void;
  hold(down: boolean): void;
  release(): void;
  reset(): void;
  dispose(): void;
}

// Spherical Voronoi cells give the frost irregular plates, not a triangle grid.
function frostGeometry() {
  const seeds = Array.from({ length: 115 }, (_, i) => {
    const y = 1 - (2 * (i + 0.5)) / 115;
    const a = i * 2.3999632297;
    const r = Math.sqrt(1 - y * y);
    return new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
  });
  const hull = new ConvexGeometry(seeds);
  const hp = hull.getAttribute('position');
  const corners: THREE.Vector3[][] = seeds.map(() => []);
  for (let i = 0; i < hp.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(hp, i);
    const b = new THREE.Vector3().fromBufferAttribute(hp, i + 1);
    const c = new THREE.Vector3().fromBufferAttribute(hp, i + 2);
    const circum = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    if (circum.dot(a) < 0) circum.negate();
    for (const v of [a, b, c]) {
      let closest = 0;
      for (let k = 1; k < seeds.length; k++)
        if (v.dot(seeds[k]) > v.dot(seeds[closest])) closest = k;
      corners[closest].push(circum.clone());
    }
  }
  hull.dispose();
  const positions: number[] = [],
    normals: number[] = [],
    centers: number[] = [],
    shards: number[] = [],
    colors: number[] = [];
  function triangle(
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    center: THREE.Vector3,
    shard: THREE.Vector3,
    tint: THREE.Color,
    depth: number,
  ) {
    if (depth > 0) {
      const ab = a.clone().add(b).normalize(),
        bc = b.clone().add(c).normalize(),
        ca = c.clone().add(a).normalize();
      triangle(a, ab, ca, center, shard, tint, depth - 1);
      triangle(ab, b, bc, center, shard, tint, depth - 1);
      triangle(ca, bc, c, center, shard, tint, depth - 1);
      triangle(ab, bc, ca, center, shard, tint, depth - 1);
    } else
      for (const v of [a, b, c]) {
        positions.push(v.x, v.y, v.z);
        normals.push(v.x, v.y, v.z);
        centers.push(center.x, center.y, center.z);
        shards.push(shard.x, shard.y, shard.z);
        colors.push(tint.r, tint.g, tint.b);
      }
  }
  seeds.forEach((seed, index) => {
    const tangent = new THREE.Vector3(0, 1, 0).cross(seed).normalize();
    const bitangent = seed.clone().cross(tangent);
    const ring = corners[index].sort(
      (a, b) =>
        Math.atan2(a.dot(bitangent), a.dot(tangent)) -
        Math.atan2(b.dot(bitangent), b.dot(tangent)),
    );
    const tint = new THREE.Color().setHSL(
      0.6 + Math.sin(index * 7.1) * 0.02,
      0.3,
      0.7 + (Math.sin(index * 3.7) + 1) * 0.055,
    );
    for (let i = 0; i < ring.length; i++) {
      const shard = seed.clone().add(ring[i]).add(ring[(i + 1) % ring.length]).normalize();
      triangle(seed, ring[i], ring[(i + 1) % ring.length], seed, shard, tint, 2);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('aCell', new THREE.Float32BufferAttribute(centers, 3));
  geometry.setAttribute('aShard', new THREE.Float32BufferAttribute(shards, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

export function createToy(
  canvas: HTMLCanvasElement,
  onPress: () => void,
  onError: (message: string) => void,
): ToyController {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 40);
  camera.position.set(0, 1.9, 6.9);
  camera.lookAt(0, 0, 0);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.05);
  scene.environment = environment.texture;
  room.dispose();
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xe2f1ff, 0x8e8176, 2.2));
  const key = new THREE.DirectionalLight(0xfff7ee, 4.5);
  key.position.set(-3, 5, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -4;
  key.shadow.camera.right = 4;
  key.shadow.camera.top = 4;
  key.shadow.camera.bottom = -4;
  key.shadow.normalBias = 0.025;
  key.shadow.bias = -0.0002;
  key.shadow.radius = 4;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xb1d8ff, 3);
  rim.position.set(3, 2, -3);
  scene.add(rim);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ color: 0xc9c6c0, roughness: 0.88 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.05;
  floor.receiveShadow = true;
  scene.add(floor);

  const group = new THREE.Group();
  group.rotation.set(-0.14, -0.3, -0.12);
  scene.add(group);
  const body = new PlasticBody();
  const scale = new THREE.Vector3(1.30, 0.88, 1.02);
  function frostShader(material: THREE.MeshPhysicalMaterial) {
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = 'varying vec3 vFrostPosition;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\nvFrostPosition = position;');
      shader.fragmentShader = 'varying vec3 vFrostPosition;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `
        #include <roughnessmap_fragment>
        float grain = sin(vFrostPosition.x * 186.0) * sin(vFrostPosition.y * 171.0) * sin(vFrostPosition.z * 153.0);
        roughnessFactor = clamp(roughnessFactor + grain * 0.10, 0.12, 0.6);
      `);
    };
    material.customProgramCacheKey = () => 'plastic-frost-v1';
  }

  const coreMat = new THREE.MeshPhysicalMaterial({
    color: 0x567195,
    roughness: 0.26,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
  });
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.9, 56, 40), coreMat);
  core.castShadow = true;
  group.add(core);
  const frostMat = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.31,
    metalness: 0,
    clearcoat: 0.7,
    clearcoatRoughness: 0.2,
    side: THREE.DoubleSide,
  });
  frostShader(frostMat);
  const frost = new THREE.Mesh(frostGeometry(), frostMat);
  group.add(frost);
  // A few lower-front windows reveal berries through the clear gel skin.
  const colorAttr = frost.geometry.getAttribute('color');
  const cellAttr = frost.geometry.getAttribute('aCell');
  const shardAttr = frost.geometry.getAttribute('aShard');
  for (let i = 0; i < colorAttr.count; i++) {
    if (cellAttr.getY(i) < -0.15 && cellAttr.getZ(i) > 0.2) {
      colorAttr.setXYZ(
        i,
        colorAttr.getX(i) * 0.68,
        colorAttr.getY(i) * 0.74,
        colorAttr.getZ(i) * 0.86,
      );
    }
  }
  const gelMat = new THREE.MeshPhysicalMaterial({
    color: 0xe5f1ff,
    transmission: 0.96,
    thickness: 0.23,
    ior: 1.38,
    roughness: 0.1,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    attenuationColor: new THREE.Color(0xb9cdec),
    attenuationDistance: 1.6,
  });
  const gel = new THREE.Mesh(new THREE.SphereGeometry(1.015, 72, 48), gelMat);
  group.add(gel);

  const berryMat = new THREE.MeshPhysicalMaterial({
    color: 0x243c62,
    roughness: 0.38,
    clearcoat: 0.3,
  });
  const crownMat = new THREE.MeshStandardMaterial({
    color: 0x556e91,
    roughness: 0.65,
  });
  const berries: { mesh: THREE.Group; rest: THREE.Vector3 }[] = [];
  for (let i = 0; i < 8; i++) {
    const berry = new THREE.Group();
    const a = i * 2.3999;
    const x = Math.cos(a) * (0.33 + (i % 3) * 0.16);
    const y = -0.18 - (i % 3) * 0.14;
    const z = Math.sqrt(Math.max(0.1, 0.96 - x * x - y * y));
    const rest = new THREE.Vector3(x * 1.3, y * 0.88, z * 0.95);
    berry.position.copy(rest);
    const fruit = new THREE.Mesh(
      new THREE.SphereGeometry(0.115 + (i % 3) * 0.016, 20, 16),
      berryMat,
    );
    fruit.scale.y = 0.87;
    berry.add(fruit);
    for (let k = 0; k < 5; k++) {
      const petal = new THREE.Mesh(
        new THREE.ConeGeometry(0.018, 0.055, 3),
        crownMat,
      );
      petal.position.set(
        Math.sin(k * Math.PI * 0.4) * 0.027,
        0.07,
        0.082 + Math.cos(k * Math.PI * 0.4) * 0.023,
      );
      petal.rotation.x = 0.6;
      petal.rotation.z = k * Math.PI * 0.4;
      berry.add(petal);
    }
    group.add(berry);
    berries.push({ mesh: berry, rest });
  }
  const leaves: { mesh: THREE.Mesh; rest: THREE.Vector3 }[] = [];
  const leafMat = new THREE.MeshPhysicalMaterial({
    color: 0x386343,
    roughness: 0.45,
  });
  for (let i = 0; i < 5; i++) {
    const leaf = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 16, 10),
      leafMat,
    );
    leaf.scale.set(0.48, 1, 0.12);
    leaf.position.set(0.54 + (i % 2) * 0.09, -0.1 + i * 0.09, 0.82 - i * 0.014);
    leaf.rotation.z = i % 2 ? -0.7 : 0.65;
    group.add(leaf);
    leaves.push({ mesh: leaf, rest: leaf.position.clone() });
  }

  // All visible layers, inclusions and raycasts use the same deformed geometry.
  const bindingCache = new Map<string, Binding>();
  const bind = (p: THREE.Vector3) => {
    const key = p.toArray().map((v) => v.toFixed(5)).join(',');
    let found = bindingCache.get(key);
    if (!found) { found = body.bind(p); bindingCache.set(key, found); }
    return found;
  };
  const layers = [core, frost, gel].map((mesh) => {
    const attr = mesh.geometry.getAttribute('position');
    const bindings = Array.from({ length: attr.count }, (_, i) => {
      const p = new THREE.Vector3().fromBufferAttribute(attr, i);
      if (mesh === frost) p.multiplyScalar(0.965);
      return bind(p.multiply(scale));
    });
    const cells = mesh === frost
      ? Array.from({ length: attr.count }, (_, i) =>
        bind(new THREE.Vector3().fromBufferAttribute(cellAttr, i).multiplyScalar(0.965).multiply(scale)))
      : null;
    const shards = mesh === frost
      ? Array.from({ length: attr.count }, (_, i) =>
        bind(new THREE.Vector3().fromBufferAttribute(shardAttr, i).multiplyScalar(0.965).multiply(scale)))
      : null;
    return { mesh, bindings, cells, shards };
  });
  const inclusions = [...berries, ...leaves].map((item) => ({ ...item, binding: bind(item.rest) }));
  const out = new THREE.Vector3(), cell = new THREE.Vector3(), shard = new THREE.Vector3();
  const shardAxes = new Map<Binding, { axis: THREE.Vector3; seed: number }>();
  for (const layer of layers) for (const binding of layer.shards ?? []) {
    if (shardAxes.has(binding)) continue;
    const normal = binding.rest.clone().normalize();
    const axis = new THREE.Vector3(Math.abs(normal.y) > 0.9 ? 1 : 0, Math.abs(normal.y) > 0.9 ? 0 : 1, 0).cross(normal).normalize();
    const seed = (Math.sin(binding.rest.x * 129 + binding.rest.y * 79 + binding.rest.z * 36) + 1) * 0.5;
    shardAxes.set(binding, { axis, seed });
  }
  const rotation = new THREE.Matrix4().makeRotationFromEuler(group.rotation);
  const updateGeometry = () => {
    let bottom = Infinity;
    const poses = new Map<Binding, ReturnType<typeof fracturePose>>();
    for (const { mesh, bindings, cells, shards } of layers) {
      const attr = mesh.geometry.getAttribute('position');
      for (let i = 0; i < bindings.length; i++) {
        body.sample(bindings[i], out);
        if (cells && shards) {
          const binding = cells[i], piece = shards[i];
          const { axis, seed } = shardAxes.get(piece)!;
          let pose = poses.get(piece);
          if (!pose) { pose = fracturePose(body.damageAt(piece), seed); poses.set(piece, pose); }
          body.sample(binding, cell);
          body.sample(piece, shard);
          // Open the main plate, then split it into smaller tilted wedges.
          out.lerp(cell, pose.opening * 0.34);
          shard.lerp(cell, pose.opening * 0.34);
          out.sub(shard).multiplyScalar(1 - pose.splitting * 0.34)
            .applyAxisAngle(axis, (seed - 0.5) * pose.splitting * 0.48).add(shard);
          // Pieces settle inward, remaining contained by the intact gel membrane.
          out.addScaledVector(piece.rest, -pose.opening * 0.008 - pose.splitting * (0.012 + seed * 0.014));
        }
        attr.setXYZ(i, out.x, out.y, out.z);
        if (mesh === gel) bottom = Math.min(bottom, out.applyMatrix4(rotation).y);
      }
      attr.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
      mesh.geometry.computeBoundingSphere();
      mesh.geometry.computeBoundingBox();
    }
    inclusions.forEach(({ mesh, binding }) => {
      body.sample(binding, mesh.position);
    });
    // Place the actual deformed silhouette on the tabletop, without idle spinning.
    group.position.y = -1.04 - bottom;
    scene.updateMatrixWorld(true);
  };
  updateGeometry();
  bindingCache.clear();

  const audio = new CrunchAudio();
  const contacts = new Map<number, {
    start: THREE.Vector2; now: THREE.Vector2; at: number; pressure: number;
    point: THREE.Vector3; normal: THREE.Vector3; plane: THREE.Plane;
  }>();
  const raycaster = new THREE.Raycaster();
  const lifecycle = new AbortController();
  let demoStart = -1, keyboard = false, last = performance.now(), frame = 0, disposed = false;
  let demoStrength = 0.96, accumulator = 0, dirty = true, crackEnergy = 0, lastCrack = 0;
  const syntheticPoint = new THREE.Vector3(), syntheticNormal = new THREE.Vector3(0, 0, 1);
  const gesture = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      1 - ((event.clientY - rect.top) / rect.height) * 2,
    );
  };
  const localRay = (v: THREE.Vector2) => {
    raycaster.setFromCamera(v, camera);
    return raycaster.ray.clone().applyMatrix4(new THREE.Matrix4().copy(group.matrixWorld).invert());
  };
  const countPress = () => {
    audio.unlock();
    onPress();
    body.begin();
    crackEnergy = 0;
  };
  const release = () => {
    const wasActive = body.active;
    const ids = [...contacts.keys()];
    contacts.clear();
    for (const id of ids) if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    keyboard = false;
    demoStart = -1;
    body.release();
    accumulator = 0;
    if (wasActive) audio.release();
    dirty = true;
  };
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const v = gesture(event);
    raycaster.setFromCamera(v, camera);
    const hit = raycaster.intersectObject(gel, false)[0];
    if (!hit) return;
    event.preventDefault();
    if (!contacts.size) { release(); countPress(); }
    canvas.setPointerCapture(event.pointerId);
    const point = group.worldToLocal(hit.point.clone());
    const normal = hit.face?.normal.clone().normalize() ?? point.clone().normalize();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(localRay(v).direction, point);
    contacts.set(event.pointerId, {
      start: v.clone(), now: v, at: performance.now(),
      pressure: event.pointerType === 'pen' ? event.pressure : 0,
      point, normal, plane,
    });
  }, { signal: lifecycle.signal });
  canvas.addEventListener('pointermove', (event) => {
    const contact = contacts.get(event.pointerId);
    if (!contact) return;
    contact.now.copy(gesture(event));
    contact.pressure = event.pointerType === 'pen' ? event.pressure : 0;
  }, { signal: lifecycle.signal });
  const up = (event: PointerEvent) => {
    if (!contacts.delete(event.pointerId)) return;
    if (!contacts.size) release();
    else {
      body.begin();
      // Rebase the remaining grip to avoid a jump after lifting one finger.
      contacts.forEach((c) => {
        const current = localRay(c.now).intersectPlane(c.plane, new THREE.Vector3());
        if (current) c.point.copy(current);
        c.start.copy(c.now);
        c.at = performance.now();
      });
    }
  };
  canvas.addEventListener('pointerup', up, { signal: lifecycle.signal });
  canvas.addEventListener('pointercancel', up, { signal: lifecycle.signal });
  canvas.addEventListener('lostpointercapture', up, { signal: lifecycle.signal });
  window.addEventListener('blur', release, { signal: lifecycle.signal });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) release();
  }, { signal: lifecycle.signal });
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault(); release(); cancelAnimationFrame(frame);
    onError('3D 畫面暫時中斷，請重新整理頁面。');
  }, { signal: lifecycle.signal });

  const resize = () => {
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.position.z = camera.aspect < 0.8 ? 7.5 : 6.9;
    camera.fov = camera.aspect < 0.8 ? 43 : 35;
    camera.updateProjectionMatrix();
    dirty = true;
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  const startSynthetic = () => {
    // Pick the current skin, so repeated demonstrations keep kneading the dent.
    body.sample(body.bind(new THREE.Vector3(0, 0.15, 1.02)), syntheticPoint);
    syntheticNormal.set(0, 0.15, 1).normalize();
  };
  function animate(now: number) {
    if (disposed) return;
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (!document.hidden) {
      const grips: Grip[] = [];
      for (const c of contacts.values()) {
        const projected = localRay(c.now).intersectPlane(c.plane, new THREE.Vector3());
        const drag = projected ? projected.sub(c.point).clampLength(0, 0.7) : new THREE.Vector3();
        const held = Math.min(1, (now - c.at) / 1200);
        grips.push({
          point: c.point, normal: c.normal, drag,
          depth: Math.min(0.65, 0.08 + held * 0.34 + c.pressure * 0.22),
        });
      }
      if (keyboard || demoStart >= 0) {
        const t = demoStart >= 0 ? (now - demoStart) / 1000 : 1;
        if (demoStart >= 0 && t >= 1.8) release();
        else grips.push({
          point: syntheticPoint, normal: syntheticNormal,
          drag: new THREE.Vector3(-0.12, -0.12, 0),
          depth: Math.min(1, t / 1.2) * demoStrength * 0.58,
        });
      }
      if (body.active && grips.length) {
        accumulator = Math.min(accumulator + dt, 0.05);
        while (accumulator >= 1 / 120) {
          body.step(1 / 120, grips);
          crackEnergy += body.broken;
          accumulator -= 1 / 120;
        }
        if (crackEnergy > 0.024 && now - lastCrack > 85) {
          audio.crack(Math.min(1, 0.3 + crackEnergy));
          navigator.vibrate?.([6, 14, 4]);
          crackEnergy = 0; lastCrack = now;
        }
        audio.friction(body.movement * 4);
        updateGeometry();
        dirty = true;
      }
      if (dirty) { renderer.render(scene, camera); dirty = false; }
    }
    frame = requestAnimationFrame(animate);
  }
  scene.updateMatrixWorld(true);
  frame = requestAnimationFrame(animate);
  return {
    setSound(enabled) { audio.setEnabled(enabled); },
    squeeze(strength = 0.96) {
      release();
      demoStrength = THREE.MathUtils.clamp(strength, 0.2, 1);
      countPress(); startSynthetic();
      demoStart = performance.now();
    },
    hold(down) {
      if (down && !keyboard) {
        release(); countPress(); startSynthetic();
        keyboard = true;
      } else if (!down) release();
    },
    release,
    reset() {
      release(); body.reset(); updateGeometry(); dirty = true;
    },
    dispose() {
      disposed = true;
      lifecycle.abort();
      observer.disconnect();
      cancelAnimationFrame(frame);
      audio.dispose();
      const geometries = new Set<THREE.BufferGeometry>(),
        materials = new Set<THREE.Material>();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          geometries.add(obj.geometry);
          for (const m of Array.isArray(obj.material)
            ? obj.material
            : [obj.material])
            materials.add(m);
        }
      });
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      environment.dispose();
      renderer.dispose();
    },
  };
}
