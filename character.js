import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Mixamo Xbot: real skinning and locomotion clips, with additive airborne poses. */
export class RunnerCharacter {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'MixamoRunner';
    this.pose = { slide: 0, jump: 0 };
    this.actions = {};
    this.bones = {};
    this.ready = this.load();
  }

  async load() {
    const gltf = await new GLTFLoader().loadAsync(new URL('./assets/models/runner.glb', import.meta.url).href);
    this.model = gltf.scene;
    const bounds = new THREE.Box3().setFromObject(this.model);
    const scale = 2.55 / bounds.getSize(new THREE.Vector3()).y;
    this.model.scale.multiplyScalar(scale);
    this.model.rotation.y = Math.PI;
    this.model.position.y = -bounds.min.y * scale;
    this.baseY = this.model.position.y;
    this.model.traverse(object => {
      if (object.isBone) this.bones[object.name.replace(/^mixamorig:?/, '').toLowerCase()] = object;
      if (!object.isMesh) return;
      object.castShadow = true;
      object.receiveShadow = true;
      // Each game owns its materials; the downloaded character stays unmodified.
      object.material = object.material.clone();
      object.material.color.set(object.material.name.includes('Joints') ? 0x243f50 : 0xf29458);
      object.material.roughness = .52;
      object.material.metalness = .18;
      object.frustumCulled = false;
    });
    this.root.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    for (const name of ['idle', 'walk', 'run']) {
      const clip = gltf.animations.find(clip => clip.name.toLowerCase() === name);
      if (!clip) throw new Error(`Runner model is missing its ${name} animation.`);
      this.actions[name] = this.mixer.clipAction(clip);
    }
    this.setAction('idle');
    this.mixer.update(0);
    this.root.updateMatrixWorld(true);
    const hips = this.bones.hips;
    this.hipScale = hips ? hips.parent.getWorldScale(new THREE.Vector3()).y : 1;
    return this;
  }

  setAction(name) {
    if (this.activeName === name) return;
    const next = this.actions[name];
    const previous = this.actions[this.activeName];
    next.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).play();
    if (previous) previous.crossFadeTo(next, .22, false);
    this.activeName = name;
  }

  update(dt, speed, state) {
    if (!this.mixer) return;
    const target = !state.running ? 'idle' : speed < 7 ? 'walk' : 'run';
    this.setAction(target);
    this.actions[target].setEffectiveTimeScale(target === 'run' ? THREE.MathUtils.clamp(speed / 11, .8, 1.45) : 1);
    this.mixer.update(dt);
    this.pose.slide = THREE.MathUtils.damp(this.pose.slide, state.sliding ? 1 : 0, 18, dt);
    this.pose.jump = THREE.MathUtils.damp(this.pose.jump, state.jumpHeight > .15 ? 1 : 0, 15, dt);
    const slide = this.pose.slide, jump = this.pose.jump;
    const bend = (name, x, z = 0) => {
      const bone = this.bones[name];
      if (bone) { bone.rotateX(x); bone.rotateZ(z); }
    };
    // Mixer restores the source pose each frame before these additive offsets.
    if (this.bones.hips) this.bones.hips.position.y -= slide * 1.1 / this.hipScale;
    bend('spine', slide * .45);
    bend('leftupleg', -slide * 1.25 - jump * .45);
    bend('rightupleg', -slide * 1.25 - jump * .7);
    bend('leftleg', slide * 1.9 + jump * .65);
    bend('rightleg', slide * 1.9 + jump * .95);
    bend('leftarm', -jump * .4, slide * -.15);
    bend('rightarm', -jump * .4, slide * .15);
    this.root.rotation.x = THREE.MathUtils.damp(this.root.rotation.x, slide * -.12, 14, dt);
  }
}
