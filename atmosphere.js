import * as THREE from 'three';

export function makeSurfaceTexture(kind) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  let seed = 12345;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  ctx.fillStyle = kind === 'stone' ? '#dfd2b8' : '#fffaf0';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5500; i++) {
    ctx.fillStyle = `rgba(102,83,57,${random() * (kind === 'stone' ? .11 : .045)})`;
    ctx.fillRect(random() * 256, random() * 256, 1 + random() * 3, 1 + random() * 2);
  }
  if (kind === 'stone') {
    ctx.strokeStyle = '#b9b29e'; ctx.lineWidth = 2;
    for (let row = 0; row < 4; row++) {
      const y = row * 64;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(256, y); ctx.stroke();
      for (let col = 0; col < 3; col++) {
        const x = col * 128 + (row % 2 ? 64 : 0);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 64); ctx.stroke();
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(kind === 'stone' ? 3 : 2, kind === 'stone' ? 3 : 2);
  return texture;
}

export class CoastAtmosphere {
  constructor(scene) {
    this.time = 0;
    const skyMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, toneMapped: false,
      uniforms: {},
      vertexShader: 'varying vec3 vPosition; void main(){vPosition=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: `varying vec3 vPosition;
        void main(){float h=normalize(vPosition).y;
          vec3 horizon=vec3(.97,.83,.68); vec3 blue=vec3(.35,.65,.79);
          vec3 color=mix(horizon,blue,smoothstep(-.02,.68,h));
          gl_FragColor=vec4(color,1.);}`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(210, 24, 16), skyMaterial);
    scene.add(sky);

    this.waterMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `varying vec3 vWorld; uniform float uTime;
        void main(){vec3 p=position; p.z+=sin(p.x*.17+uTime*.75)*.1+sin(p.y*.13+uTime*.6)*.08;
          vec4 world=modelMatrix*vec4(p,1.);vWorld=world.xyz;gl_Position=projectionMatrix*viewMatrix*world;}`,
      fragmentShader: `varying vec3 vWorld;uniform float uTime;
        void main(){
          float waves=sin(vWorld.x*.7+vWorld.z*.24+uTime*.9)*sin(vWorld.z*.8-uTime*.65);
          float glitter=pow(max(0.,waves),12.);
          float coast=1.-smoothstep(5.,18.,abs(vWorld.x));
          vec3 water=mix(vec3(.035,.36,.43),vec3(.12,.64,.62),coast*.75+.15);
          water+=waves*.025+vec3(.72,.83,.67)*glitter*.3;
          float haze=smoothstep(40.,180.,-vWorld.z);
          gl_FragColor=vec4(mix(water,vec3(.73,.82,.78),haze*.82),1.);
        }`,
      toneMapped: false,
    });
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(360, 360, 85, 85), this.waterMaterial);
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.set(0, -1.25, -90);
    scene.add(this.water);

    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = glowCanvas.height = 128;
    const context = glowCanvas.getContext('2d');
    const gradient = context.createRadialGradient(64, 64, 2, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255,240,192,1)');
    gradient.addColorStop(.2, 'rgba(255,227,156,.85)');
    gradient.addColorStop(.45, 'rgba(255,222,169,.2)');
    gradient.addColorStop(1, 'rgba(255,224,170,0)');
    context.fillStyle = gradient; context.fillRect(0, 0, 128, 128);
    const glowTexture = new THREE.CanvasTexture(glowCanvas);
    glowTexture.colorSpace = THREE.SRGBColorSpace;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, depthWrite: false, toneMapped: false, transparent: true, fog: false, blending: THREE.AdditiveBlending }));
    glow.position.set(43, 32, -145); glow.scale.set(47, 47, 1); scene.add(glow);

    this.birds = new THREE.Group();
    const birdMaterial = new THREE.MeshBasicMaterial({ color: 0x496d74, side: THREE.DoubleSide });
    const shape = new THREE.Shape(); shape.moveTo(0, 0); shape.lineTo(.65, .15); shape.lineTo(1.25, -.1); shape.lineTo(.6, .01);
    const wingGeometry = new THREE.ShapeGeometry(shape);
    for (let i = 0; i < 7; i++) {
      const bird = new THREE.Group();
      for (const side of [-1, 1]) {
        const wing = new THREE.Mesh(wingGeometry, birdMaterial); wing.scale.x = side;
        bird.add(wing);
      }
      bird.position.set(12 + i * 4, 10 + Math.sin(i) * 3, -42 - i * 7);
      bird.userData.base = bird.position.clone(); this.birds.add(bird);
    }
    scene.add(this.birds);

    this.particles = [];
    this.particleGeometry = new THREE.IcosahedronGeometry(.07, 0);
    this.particleMaterial = new THREE.MeshBasicMaterial({ color: 0xffd379 });
    this.dustMaterial = new THREE.MeshBasicMaterial({ color: 0xe4c59c, transparent: true, opacity: .42, depthWrite: false });
    this.scene = scene;
    this.dustTime = 0;
  }

  burst(position, count = 14) {
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(this.particleGeometry, this.particleMaterial);
      mesh.position.copy(position);
      this.scene.add(mesh);
      this.particles.push({ mesh, life: .6 + Math.random() * .3, total: .9, velocity: new THREE.Vector3((Math.random() - .5) * 4, 1 + Math.random() * 3, (Math.random() - .5) * 4) });
    }
  }

  update(dt, speed, player, running) {
    this.time += dt;
    this.waterMaterial.uniforms.uTime.value = this.time;
    this.birds.children.forEach((bird, i) => {
      bird.position.x = bird.userData.base.x + Math.sin(this.time * .11 + i) * 6;
      bird.position.y = bird.userData.base.y + Math.sin(this.time * .4 + i) * .3;
      bird.children.forEach((wing, j) => wing.rotation.z = Math.sin(this.time * 3 + i) * .25 * (j ? 1 : -1));
    });
    this.dustTime -= dt;
    if (running && speed > 7 && player.position.y < .1 && this.dustTime <= 0) {
      const mesh = new THREE.Mesh(this.particleGeometry, this.dustMaterial);
      mesh.position.copy(player.position).add(new THREE.Vector3((Math.random() - .5) * .5, .08, .15));
      this.scene.add(mesh);
      this.particles.push({ mesh, life: .45, total: .45, dust: true, velocity: new THREE.Vector3(0, .3, speed * .65) });
      this.dustTime = .1;
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]; p.life -= dt;
      p.mesh.position.addScaledVector(p.velocity, dt);
      if (!p.dust) p.velocity.y -= dt * 6;
      p.mesh.scale.setScalar(p.dust ? 1 + (1 - p.life / p.total) * 2 : Math.max(0, p.life / p.total));
      if (p.life <= 0) { this.scene.remove(p.mesh); this.particles.splice(i, 1); }
    }
  }
}
