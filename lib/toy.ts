import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { CrunchAudio } from './crunch-audio';

export interface ToyController {
  setSound(enabled: boolean): void;
  squeeze(strength?: number): void;
  hold(down: boolean): void;
  release(): void;
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
    colors: number[] = [];
  function triangle(
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    center: THREE.Vector3,
    tint: THREE.Color,
    depth: number,
  ) {
    if (depth > 0) {
      const ab = a.clone().add(b).normalize(),
        bc = b.clone().add(c).normalize(),
        ca = c.clone().add(a).normalize();
      triangle(a, ab, ca, center, tint, depth - 1);
      triangle(ab, b, bc, center, tint, depth - 1);
      triangle(ca, bc, c, center, tint, depth - 1);
      triangle(ab, bc, ca, center, tint, depth - 1);
    } else
      for (const v of [a, b, c]) {
        positions.push(v.x, v.y, v.z);
        normals.push(v.x, v.y, v.z);
        centers.push(center.x, center.y, center.z);
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
    for (let i = 0; i < ring.length; i++)
      triangle(seed, ring[i], ring[(i + 1) % ring.length], seed, tint, 2);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('aCell', new THREE.Float32BufferAttribute(centers, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

const deformation = `
uniform float uPress;
uniform float uBreak;
uniform float uTime;
uniform vec3 uTouch;
vec3 deformGel(vec3 p) {
  float locality = exp(-5.0 * dot(normalize(p) - uTouch, normalize(p) - uTouch));
  float wrinkle = sin(p.x * 16.0 + p.y * 10.0 + p.z * 9.0) * uBreak * locality * 0.017;
  p -= uTouch * locality * uPress * 0.26;
  p *= 1.0 + wrinkle;
  p.x *= 1.30 * (1.0 - uPress * 0.32);
  p.y *= 0.88 * (1.0 + uPress * 0.12);
  p.z *= 1.02 * (1.0 + uPress * 0.21);
  p.x += sin(p.y * 3.0 + uTime * 2.8) * uPress * 0.025;
  return p;
}
`;

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
  const uniforms = {
    uPress: { value: 0 },
    uBreak: { value: 0 },
    uTime: { value: 0 },
    uTouch: { value: new THREE.Vector3(0, 0.15, 1).normalize() },
  };
  function materialShader(
    material: THREE.MeshPhysicalMaterial,
    frost: boolean,
  ) {
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader =
        deformation +
        (frost ? 'attribute vec3 aCell; varying vec3 vFrostPosition;\n' : '') +
        shader.vertexShader;
      const patch = frost
        ? `
        vec3 cell = aCell;
        float proximity = exp(-2.0 * dot(cell - uTouch, cell - uTouch));
        float fracture = uBreak * (0.35 + 0.65 * proximity);
        float randomPlate = fract(sin(dot(cell, vec3(12.989, 78.233, 36.12))) * 43758.5453);
        vec3 fragment = cell + (position - cell) * (1.0 - fracture * 0.20);
        fragment *= 1.0 + fracture * (randomPlate - 0.42) * 0.075;
        vec3 transformed = deformGel(fragment * 0.965);
        vFrostPosition = position;
      `
        : 'vec3 transformed = deformGel(position);';
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        patch,
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <beginnormal_vertex>',
        `
        vec3 n = normalize(normal);
        vec3 tangentAxis = abs(n.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
        vec3 t = normalize(cross(tangentAxis, n));
        vec3 b = cross(n, t);
        vec3 base = deformGel(position);
        vec3 objectNormal = normalize(cross(deformGel(position + t * 0.004) - base, deformGel(position + b * 0.004) - base));
        vec3 objectTangent = t;
      `,
      );
      if (frost) {
        shader.fragmentShader =
          'varying vec3 vFrostPosition;\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <roughnessmap_fragment>',
          `
          #include <roughnessmap_fragment>
          float grain = sin(vFrostPosition.x * 186.0) * sin(vFrostPosition.y * 171.0) * sin(vFrostPosition.z * 153.0);
          roughnessFactor = clamp(roughnessFactor + grain * 0.10, 0.12, 0.6);
        `,
        );
      }
    };
    material.customProgramCacheKey = () =>
      frost ? 'frost-plates-v2' : 'clear-gel-v2';
  }

  const coreMat = new THREE.MeshPhysicalMaterial({
    color: 0x567195,
    roughness: 0.26,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
  });
  materialShader(coreMat, false);
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.9, 56, 40), coreMat);
  const depthMaterial = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
  });
  depthMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader =
      deformation +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        'vec3 transformed = deformGel(position);',
      );
  };
  core.customDepthMaterial = depthMaterial;
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
  materialShader(frostMat, true);
  const frost = new THREE.Mesh(frostGeometry(), frostMat);
  group.add(frost);
  // A few lower-front windows reveal berries through the clear gel skin.
  const colorAttr = frost.geometry.getAttribute('color');
  const cellAttr = frost.geometry.getAttribute('aCell');
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
  materialShader(gelMat, false);
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
  }

  const audio = new CrunchAudio();
  const contacts = new Map<
    number,
    { start: THREE.Vector2; now: THREE.Vector2; at: number; pressure: number }
  >();
  const raycaster = new THREE.Raycaster();
  const lifecycle = new AbortController();
  let press = 0,
    velocity = 0,
    fracture = 0,
    fractureLevel = 0;
  let demoStart = -1,
    keyboard = false,
    last = performance.now(),
    frame = 0,
    disposed = false;
  let previousPress = 0;
  let demoStrength = 0.96;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const gesture = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      1 - ((event.clientY - rect.top) / rect.height) * 2,
    );
  };
  const hitPoint = (v: THREE.Vector2) => {
    raycaster.setFromCamera(v, camera);
    // Raycast against an undeformed ellipsoid matching the neutral gel silhouette.
    const inverse = new THREE.Matrix4().copy(group.matrixWorld).invert();
    const ray = raycaster.ray.clone().applyMatrix4(inverse);
    ray.origin.divide(new THREE.Vector3(1.3, 0.88, 1.02));
    ray.direction.divide(new THREE.Vector3(1.3, 0.88, 1.02)).normalize();
    return ray.intersectSphere(
      new THREE.Sphere(new THREE.Vector3(), 1.08),
      new THREE.Vector3(),
    );
  };
  const countPress = () => {
    audio.unlock();
    onPress();
    fractureLevel = 0;
  };
  const release = () => {
    const wasActive = contacts.size > 0 || keyboard;
    contacts.clear();
    keyboard = false;
    demoStart = -1;
    if (wasActive) audio.release();
  };
  canvas.addEventListener(
    'pointerdown',
    (event) => {
      if (event.button !== 0) return;
      const v = gesture(event),
        hit = hitPoint(v);
      if (!hit) return;
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      if (!contacts.size) countPress();
      uniforms.uTouch.value.copy(hit.normalize());
      contacts.set(event.pointerId, {
        start: v.clone(),
        now: v,
        at: performance.now(),
        pressure: event.pointerType === 'pen' ? event.pressure : 0,
      });
    },
    { signal: lifecycle.signal },
  );
  canvas.addEventListener(
    'pointermove',
    (event) => {
      const contact = contacts.get(event.pointerId);
      if (!contact) return;
      contact.now.copy(gesture(event));
      contact.pressure = event.pointerType === 'pen' ? event.pressure : 0;
    },
    { signal: lifecycle.signal },
  );
  const up = (event: PointerEvent) => {
    if (!contacts.delete(event.pointerId)) return;
    if (!contacts.size) audio.release();
  };
  canvas.addEventListener('pointerup', up, { signal: lifecycle.signal });
  canvas.addEventListener('pointercancel', up, { signal: lifecycle.signal });
  canvas.addEventListener('lostpointercapture', up, {
    signal: lifecycle.signal,
  });
  window.addEventListener('blur', release, { signal: lifecycle.signal });
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) release();
    },
    { signal: lifecycle.signal },
  );
  canvas.addEventListener(
    'webglcontextlost',
    (event) => {
      event.preventDefault();
      release();
      cancelAnimationFrame(frame);
      onError('3D 畫面暫時中斷，請重新整理頁面。');
    },
    { signal: lifecycle.signal },
  );

  const resize = () => {
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.position.z = camera.aspect < 0.8 ? 7.5 : 6.9;
    camera.fov = camera.aspect < 0.8 ? 43 : 35;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  function animate(now: number) {
    if (disposed) return;
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    if (document.hidden) {
      frame = requestAnimationFrame(animate);
      return;
    }
    let target = keyboard ? 0.88 : 0;
    for (const c of contacts.values()) {
      const travel = c.now.distanceTo(c.start);
      const held = Math.min(1, (now - c.at) / 1600);
      target = Math.max(
        target,
        Math.min(1, 0.2 + travel * 1.8 + held * 0.4 + c.pressure * 0.3),
      );
    }
    if (contacts.size > 1) {
      const [a, b] = [...contacts.values()];
      target = Math.max(
        target,
        Math.min(
          1,
          0.3 +
            Math.max(0, a.start.distanceTo(b.start) - a.now.distanceTo(b.now)) *
              2.8,
        ),
      );
    }
    if (demoStart >= 0) {
      const t = (now - demoStart) / 1000;
      target =
        t < 1.5
          ? Math.min(demoStrength, t * 0.85)
          : Math.max(0, demoStrength - (t - 1.5) * 1.9);
      if (t > 2.02) {
        demoStart = -1;
        audio.release();
      }
    }
    velocity += ((target - press) * 70 - velocity * (reduced ? 19 : 13)) * dt;
    press = THREE.MathUtils.clamp(press + velocity * dt, 0, 1.05);
    // Four yield points: a brief give in resistance + a cluster of tiny cracks.
    const level = Math.max(0, Math.floor((press - 0.31) / 0.14) + 1);
    if (level > fractureLevel && target > 0) {
      fractureLevel = level;
      fracture = Math.min(1, fracture + 0.19);
      velocity += 0.38;
      audio.crack(press);
      navigator.vibrate?.([7, 18, 5]);
    }
    if (!target) {
      fracture *= Math.exp(-dt * 1.8);
      if (press < 0.08) fractureLevel = 0;
    }
    audio.friction(Math.abs(press - previousPress) / Math.max(0.001, dt));
    previousPress = press;
    uniforms.uPress.value = press;
    uniforms.uBreak.value = fracture;
    uniforms.uTime.value = reduced ? 0 : now / 1000;
    group.rotation.y =
      -0.3 + (reduced ? 0 : Math.sin(now * 0.00028) * 0.1) + press * 0.12;
    group.rotation.z = -0.12 + press * 0.1;
    group.position.y = press * 0.11;
    berries.forEach(({ mesh, rest }, i) => {
      mesh.position.set(
        rest.x * (1 - press * 0.32),
        rest.y * (1 + press * 0.12),
        rest.z * (1 + press * 0.21),
      );
      mesh.rotation.z = press * Math.sin(i * 3) * 0.6;
    });
    renderer.render(scene, camera);
    frame = requestAnimationFrame(animate);
  }
  scene.updateMatrixWorld(true);
  frame = requestAnimationFrame(animate);
  return {
    setSound(enabled) {
      audio.setEnabled(enabled);
    },
    squeeze(strength = 0.96) {
      release();
      demoStrength = THREE.MathUtils.clamp(strength, 0.2, 1);
      countPress();
      uniforms.uTouch.value.set(0, 0.2, 1).normalize();
      demoStart = performance.now();
    },
    hold(down) {
      if (down && !keyboard) {
        countPress();
        keyboard = true;
      } else if (!down) {
        keyboard = false;
        audio.release();
      }
    },
    release,
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
      depthMaterial.dispose();
      renderer.dispose();
    },
  };
}
