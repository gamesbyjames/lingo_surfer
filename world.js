import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { obstacleHits } from './game-logic.js';
import { RunnerCharacter } from './character.js';
import { CoastAtmosphere, makeSurfaceTexture } from './atmosphere.js';

const LANE_WIDTH = 3.15;
const PLAYER_Z = 6;
const colors = { stone: 0xf2e6d0, edge: 0xf7ead4, white: 0xfff8e9, blue: 0x287ba4, leaf: 0x6e9255, dark: 0x315d58, coral: 0xdc7959, gold: 0xf1be57 };

export class CoastWorld {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xc5d9ce, 58, 170);
    this.camera = new THREE.PerspectiveCamera(49, 1, 0.1, 240);
    this.camera.position.set(0, 6.8, 17.8);
    this.camera.lookAt(0, 1.6, -22);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.03;
    container.append(this.renderer.domElement);
    this.materials = new Map();
    this.mat(colors.stone).map = makeSurfaceTexture('stone');
    this.mat(colors.white).map = makeSurfaceTexture('stucco');
    for (const material of this.materials.values()) if (material.map) material.map.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    this.scene.add(new THREE.HemisphereLight(0xc7e8fa, 0x75856a, 1.8));
    const sun = new THREE.DirectionalLight(0xffd5a1, 2.7);
    sun.position.set(-24, 37, -30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, near: 1, far: 120 });
    sun.shadow.bias = -0.001;
    sun.shadow.normalBias = .035;
    sun.shadow.radius = 3;
    sun.target.position.set(0, 0, -12);
    this.scene.add(sun, sun.target);

    this.atmosphere = new CoastAtmosphere(this.scene);
    for (let i = 0; i < 4; i++) {
      const island = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), this.mat(0x8aa69b));
      island.scale.set(10 + i * 3, 3.5 + i * 1.6, 7);
      island.position.set(30 + i * 18, -1, -105 - i * 17);
      this.scene.add(island);
    }

    this.sections = [];
    for (let cluster = 0; cluster < 4; cluster++) {
      const group = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const tile = this.makeSection(cluster * 4 + i);
        tile.position.z = -i * 12;
        group.add(tile);
      }
      this.batchScenery(group);
      group.position.z = 16 - cluster * 48;
      this.scene.add(group);
      this.sections.push(group);
    }
    this.runner = new RunnerCharacter();
    this.ready = this.runner.ready;
    this.player = this.runner.root;
    this.player.position.z = PLAYER_Z;
    this.scene.add(this.player);
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(.55, 24), new THREE.MeshBasicMaterial({ color: 0x3c6056, transparent: true, opacity: .13, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.set(0, .045, PLAYER_Z);
    this.scene.add(this.shadow);
    this.entities = [];
    this.gates = null;
    this.time = 0;
    this.shake = 0;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  mat(color) {
    if (!this.materials.has(color)) this.materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: .88 }));
    return this.materials.get(color);
  }
  batchScenery(group) {
    // Merge by material: a whole stretch of houses and paving takes only a few
    // draw calls, rather than one per window, flag, and paving seam.
    group.updateMatrixWorld(true);
    const batches = new Map();
    group.traverse(mesh => {
      if (!mesh.isMesh) return;
      if (!batches.has(mesh.material)) batches.set(mesh.material, []);
      batches.get(mesh.material).push(mesh.geometry.clone().applyMatrix4(mesh.matrixWorld));
      mesh.geometry.dispose();
    });
    group.clear();
    for (const [material, geometries] of batches) {
      const mesh = new THREE.Mesh(mergeGeometries(geometries), material);
      mesh.castShadow = true; mesh.receiveShadow = true;
      group.add(mesh);
      geometries.forEach(geometry => geometry.dispose());
    }
  }
  box(w, h, d, color) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.mat(color));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
  put(parent, mesh, x, y, z) { mesh.position.set(x, y, z); parent.add(mesh); return mesh; }
  cylinder(top, bottom, height, color, sides = 8) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, height, sides), this.mat(color));
    mesh.castShadow = true;
    return mesh;
  }
  makeSection(index) {
    const g = new THREE.Group();
    this.put(g, this.box(10.3, .8, 12, colors.stone), 0, -.4, 0);
    for (const side of [-1, 1]) {
      this.put(g, this.box(.33, .3, 12, colors.edge), side * 5.05, .1, 0);
      for (let j = 0; j < 3; j++) this.put(g, this.box(.18, 1, .18, colors.white), side * 5.35, .25, j * 4 - 4);
      this.put(g, this.box(.1, .1, 12, colors.white), side * 5.35, .68, 0);
    }
    for (let j = 0; j < 4; j++) {
      this.put(g, this.box(9.8, .012, .028, 0xcbbf9f), 0, .015, j * 3 - 4.5);
      for (const x of [-1.575, 1.575]) this.put(g, this.box(.045, .018, 1.3, 0xf6e7c5), x, .025, j * 3 - 4.5);
    }
    this.put(g, this.box(10, 1, 12, 0xc7c0a0), -10.4, -.65, 0);
    for (let i = 0; i < 3; i++) {
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), this.mat(0x9b9d81));
      rock.scale.set(1.4, .7, 1.6);
      this.put(g, rock, 6.2 + (i % 2) * .5, -.9, i * 4 - 4);
    }
    const house = this.makeHouse(index);
    house.position.set(-9.1 - (index % 3) * .5, 0, -2);
    g.add(house);
    if (index % 2 === 0) {
      const tree = this.makeTree();
      tree.position.set(-6.3, 0, 3.5);
      g.add(tree);
    }
    if (index % 3 === 1) {
      this.put(g, this.box(4.3, .7, 5.5, colors.stone), 7.4, -.3, -2);
      const tree = this.makeTree(); tree.position.set(7.3, 0, -2); g.add(tree);
      const pot = this.cylinder(.45, .3, .65, colors.coral);
      this.put(g, pot, 6.1, .33, .3);
      this.put(g, this.cylinder(.7, .35, .75, 0xb7858a), 6.1, .9, .3);
      const bench = this.makeBench(); bench.position.set(7.2, 0, .3); g.add(bench);
    }
    if (index % 4 === 3) {
      this.put(g, this.cylinder(.05, .08, 3.8, 0x526e61), -5.65, 1.9, 2.8);
      this.put(g, this.box(.48, .58, .48, 0xe6b969), -5.65, 3.65, 2.8);
      this.put(g, this.box(.66, .1, .66, 0x526e61), -5.65, 3.98, 2.8);
    }
    if (index % 5 === 0) {
      this.put(g, this.box(8, .6, 7, colors.edge), 10.2, -.15, -1);
      for (const x of [8, 11.5]) {
        this.put(g, this.cylinder(.38, .46, 4, colors.edge, 12), x, 2, -2.8);
        this.put(g, this.box(1.1, .25, 1.1, colors.white), x, 4.1, -2.8);
        this.put(g, this.box(1.2, .25, 1.2, colors.white), x, .12, -2.8);
      }
      this.put(g, this.box(5.1, .45, 1.15, colors.edge), 9.75, 4.43, -2.8);
      this.put(g, this.box(5.5, .15, 1.4, colors.white), 9.75, 4.72, -2.8);
    }
    if (index % 4 === 0) {
      for (const x of [-5.8, 5.8]) this.put(g, this.cylinder(.055, .075, 5.4, 0xb4a58b), x, 2.5, 0);
      this.put(g, this.box(11.6, .035, .035, 0xaaa089), 0, 4.95, 0);
      for (let k = 0; k < 12; k++) {
        const flag = new THREE.Mesh(new THREE.ConeGeometry(.21, .5, 3), this.mat(k % 2 ? 0xd48e70 : 0x718f8e));
        flag.rotation.z = Math.PI;
        this.put(g, flag, -5.2 + k * .95, 4.67, 0);
      }
    }
    if (index % 4 === 2) {
      const boat = new THREE.Group();
      this.put(boat, this.box(1.7, .5, 4, colors.white), 0, 0, 0);
      this.put(boat, this.box(1.5, .17, 3.7, colors.blue), 0, .3, 0);
      this.put(boat, this.cylinder(.035, .05, 4, colors.white), 0, 2, 0);
      const sail = new THREE.Mesh(new THREE.ConeGeometry(1.4, 3, 3), this.mat(0xfff5dd));
      sail.scale.z = .05; this.put(boat, sail, .55, 2.3, 0);
      boat.position.set(15 + index % 3 * 3, -.8, -3);
      boat.rotation.y = .45; g.add(boat);
    }
    return g;
  }
  makeBench() {
    const bench = new THREE.Group();
    for (let i = 0; i < 4; i++) this.put(bench, this.box(1.7, .09, .13, 0xb18758), 0, .58, i * .17);
    for (const x of [-.6, .6]) this.put(bench, this.box(.12, .58, .65, 0x557668), x, .29, .25);
    this.put(bench, this.box(1.7, .42, .08, 0xb18758), 0, .93, .57);
    return bench;
  }
  makeHouse(index) {
    const h = new THREE.Group();
    const height = 3.5 + (index % 3) * 1.3;
    this.put(h, this.box(4.8, height, 5.4, colors.white), 0, height / 2, 0);
    this.put(h, this.box(5, .18, 5.6, 0xf5e9cc), 0, height + .1, 0);
    this.put(h, this.box(.09, 1.7, .95, colors.blue), 2.44, .86, .4);
    for (const z of [-1.6, 1.65]) {
      this.put(h, this.box(.12, .92, .75, 0x4b797f), 2.46, height - 1.1, z);
      this.put(h, this.box(.2, .08, .95, 0xb6c6b4), 2.5, height - 1.6, z);
      for (const side of [-1, 1]) {
        const shutter = this.box(.08, 1, .3, colors.blue);
        shutter.rotation.y = side * .3;
        this.put(h, shutter, 2.52, height - 1.1, z + side * .54);
        for (let slat = 0; slat < 4; slat++) this.put(h, this.box(.03, .025, .28, 0x96c7d1), 2.57, height - 1.45 + slat * .2, z + side * .54);
      }
    }
    this.put(h, this.box(.8, .15, 3.3, colors.white), 2.75, height - 1.7, 0);
    for (let i = 0; i < 9; i++) this.put(h, this.box(.05, .68, .05, 0x60807b), 3.1, height - 1.29, -1.5 + i * .38);
    this.put(h, this.box(.06, .05, 3.2, 0x60807b), 3.1, height - .95, 0);
    if (index % 2 === 0) {
      for (let i = 0; i < 8; i++) {
        const foliage = new THREE.Mesh(new THREE.IcosahedronGeometry(.32, 0), this.mat(i % 3 ? 0xb84d7c : 0x628956));
        this.put(h, foliage, 2.7 + Math.sin(i * 2) * .12, 1.1 + i * .34, -1.5 + Math.sin(i) * .18);
      }
    }
    if (index % 3 === 0) {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(1.7, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), this.mat(colors.blue));
      dome.castShadow = true;
      this.put(h, dome, 0, height + .2, 0);
    } else {
      this.put(h, this.box(.55, 1.25, .55, colors.white), -1.4, height + .6, -1.5);
      const awning = this.box(1.4, .1, 2.1, index % 2 ? colors.blue : 0xc49e78);
      awning.rotation.z = -.13;
      this.put(h, awning, 2.9, 2, .3);
    }
    return h;
  }
  makeTree() {
    const t = new THREE.Group();
    this.put(t, this.cylinder(.12, .22, 2.1, 0x9a9070), 0, 1, 0);
    for (let i = 0; i < 3; i++) {
      const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(.95, 1), this.mat(i % 2 ? 0x9baa78 : colors.leaf));
      leaf.scale.set(1.1, .8, 1);
      leaf.castShadow = true;
      this.put(t, leaf, Math.sin(i * 2.3) * .6, 2.15 + i * .25, Math.cos(i * 2.3) * .5);
    }
    return t;
  }
  spawnObstacle(lane, kind, z = -43) {
    const g = new THREE.Group();
    if (kind === 'barrier') {
      this.put(g, this.box(2.4, .75, .8, 0xc09b70), 0, .4, 0);
      this.put(g, this.box(2.5, .16, .9, 0xe3c391), 0, .84, 0);
      for (const x of [-.8, 0, .8]) this.put(g, this.box(.09, .68, .04, 0xa9835f), x, .41, .425);
    } else {
      for (const x of [-1.2, 1.2]) this.put(g, this.box(.16, 2.8, .16, colors.blue), x, 1.4, 0);
      this.put(g, this.box(2.6, .95, .5, colors.blue), 0, 2.25, 0);
      for (let i = 0; i < 5; i++) this.put(g, this.box(.25, .15, .52, colors.white), i * .48 - .96, 1.86, 0);
    }
    g.position.set(lane * LANE_WIDTH, 0, z);
    this.scene.add(g);
    this.entities.push({ mesh: g, kind, lane, hit: false });
  }
  spawnCoins(lane, raised = false, z = -32) {
    for (let i = 0; i < 5; i++) {
      const material = this.mat(colors.gold);
      material.metalness = .6; material.roughness = .25; material.emissive.setHex(0xb27317); material.emissiveIntensity = .24;
      const coin = new THREE.Mesh(new THREE.TorusGeometry(.28, .08, 8, 16), material);
      coin.position.set(lane * LANE_WIDTH, raised ? 2 : 1, z - i * 2.5);
      this.scene.add(coin);
      this.entities.push({ mesh: coin, kind: 'coin', lane, hit: false });
    }
  }
  showGates(distance) {
    this.clearGates();
    this.gateRushSpeed = 0;
    this.gates = new THREE.Group();
    for (let lane = -1; lane <= 1; lane++) {
      const g = new THREE.Group();
      const c = lane === 0 ? 0x659586 : 0xe2b583;
      for (const x of [-1.38, 1.38]) {
        this.put(g, this.cylinder(.11, .16, 2.6, c, 12), x, 1.3, 0);
        this.put(g, this.box(.4, .2, .5, colors.edge), x, .1, 0);
        this.put(g, this.box(.36, .18, .4, colors.edge), x, 2.5, 0);
      }
      this.put(g, new THREE.Mesh(new THREE.TorusGeometry(1.38, .12, 8, 24, Math.PI), this.mat(c)), 0, 2.55, 0);
      this.put(g, new THREE.Mesh(new THREE.OctahedronGeometry(.22), this.mat(colors.gold)), 0, 3.9, 0);
      this.put(g, this.box(2.6, .035, 1.8, c), 0, .045, 0);
      g.position.x = lane * LANE_WIDTH;
      this.gates.add(g);
    }
    this.gates.position.z = PLAYER_Z - distance;
    this.scene.add(this.gates);
  }
  setGateRemaining(seconds, speed) {
    if (this.gates) this.gates.position.z = PLAYER_Z - seconds * speed;
  }
  passGate() {
    // Feedback is immediate; the arch sweeps past in 0.35s instead of making
    // the learner wait for the original countdown to finish.
    if (this.gates) this.gateRushSpeed = Math.max(20, (PLAYER_Z + 7 - this.gates.position.z) / .35);
  }
  clearGates() { if (this.gates) { this.disposeGroup(this.gates); this.gates = null; } this.gateRushSpeed = 0; }
  disposeGroup(group) {
    this.scene.remove(group);
    group.traverse(child => { if (child.geometry) child.geometry.dispose(); });
  }
  clearEntities() {
    this.entities.forEach(e => this.disposeGroup(e.mesh));
    this.entities = [];
  }
  reset() { this.clearEntities(); this.clearGates(); this.player.position.x = 0; this.shake = 0; }
  celebrate() { this.atmosphere.burst(this.player.position.clone().add(new THREE.Vector3(0, 1.5, 0)), 30); }
  resize() {
    const { width, height } = this.container.getBoundingClientRect();
    this.camera.aspect = width / Math.max(height, 1);
    // A wider view on phones keeps all three lanes in frame.
    this.camera.fov = this.camera.aspect < .85 ? 61 : 49;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }
  update(dt, speed, state) {
    this.time += dt;
    const travel = speed * dt;
    for (const section of this.sections) {
      section.position.z += travel;
      if (section.position.z > 64) section.position.z -= 192;
    }
    const targetX = state.lane * LANE_WIDTH;
    this.player.position.x = THREE.MathUtils.damp(this.player.position.x, targetX, 17, dt);
    this.player.position.y = state.jumpHeight;
    this.player.rotation.z = THREE.MathUtils.damp(this.player.rotation.z, (this.player.position.x - targetX) * .085, 12, dt);
    this.runner.update(dt, speed, state);
    this.atmosphere.update(dt, speed, this.player, state.running);
    this.shake = Math.max(0, this.shake - dt * 2.5);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, reduced ? 0 : this.player.position.x * .09, 3, dt);
    this.camera.position.y = 6.8 + (reduced ? 0 : Math.sin(this.time * 47) * this.shake * .12);
    this.player.visible = state.invincible <= 0 || Math.floor(this.time * 12) % 2 === 0;
    this.shadow.position.x = this.player.position.x;
    this.shadow.scale.setScalar(1 - state.jumpHeight * .16);
    const events = [];
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i];
      const oldZ = e.mesh.position.z;
      e.mesh.position.z += travel;
      if (e.kind === 'coin') e.mesh.rotation.y += dt * 2;
      // Cross a swept z interval so a slower frame cannot skip a collision.
      if (!e.hit && oldZ < PLAYER_Z + .6 && e.mesh.position.z >= PLAYER_Z - .6) {
        const inLane = Math.abs(this.player.position.x - e.lane * LANE_WIDTH) < 1.08;
        if (inLane && state.running) {
          if (e.kind === 'coin' && Math.abs(e.mesh.position.y - (state.jumpHeight + 1)) < 1) {
            e.hit = true; e.mesh.visible = false; events.push('coin');
            this.atmosphere.burst(e.mesh.position, 6);
          } else if (e.kind !== 'coin' && obstacleHits(e.kind, state.jumpHeight, state.sliding)) {
            e.hit = true; events.push('hit');
            if (state.invincible <= 0) this.shake = .7;
          }
        }
      }
      if (e.mesh.position.z > 20) { this.disposeGroup(e.mesh); this.entities.splice(i, 1); }
    }
    if (this.gates) {
      this.gates.position.z += this.gateRushSpeed ? this.gateRushSpeed * dt : travel;
      if (this.gates.position.z > PLAYER_Z + 7) this.clearGates();
    }
    return events;
  }
  render() { this.renderer.render(this.scene, this.camera); }
}
