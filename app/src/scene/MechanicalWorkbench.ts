import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { CollisionHit, Pose } from '../physics/RapierPhysics';
import { RapierPhysics } from '../physics/RapierPhysics';
import type { MechanicalProject, StudioPart, Vec3 } from '../model/mechanical';
import { WORLD_PER_MM, cloneProject, fromWorld, toWorld } from '../model/mechanical';

export type TransformMode = 'translate' | 'rotate' | 'scale';
export interface WorkbenchCallbacks {
  onSelect: (part: StudioPart | null) => void;
  onChanged: (part: StudioPart, final: boolean) => void;
  onCollision: (moved: StudioPart, blocker: CollisionHit) => void;
  onPhysics: (status: string, ready: boolean) => void;
  onBeforeEdit?: () => void;
}

export class MechanicalWorkbench {
  readonly physics = new RapierPhysics();
  readonly ready: Promise<void>;
  private mount: HTMLElement;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(43, 1, 0.03, 300);
  private renderer: THREE.WebGLRenderer;
  private orbit: OrbitControls;
  private transform: TransformControls;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private parts = new Map<string, THREE.Group>();
  private project: MechanicalProject;
  private callbacks: WorkbenchCallbacks;
  private selectedId: string | null = null;
  private raf = 0;
  private resizeObserver: ResizeObserver;
  private lastPose = new Map<string, Pose>();
  private dragStartSize: Vec3 | null = null;
  private pointerStart: { x: number; y: number } | null = null;
  private disposed = false;

  constructor(mount: HTMLElement, project: MechanicalProject, callbacks: WorkbenchCallbacks) {
    this.mount = mount;
    this.project = cloneProject(project);
    this.callbacks = callbacks;
    this.scene.background = new THREE.Color('#08111b');
    this.scene.fog = new THREE.Fog('#08111b', 22, 90);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(Math.max(1, mount.clientWidth), Math.max(1, mount.clientHeight));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = 'workbench-canvas';
    this.renderer.domElement.setAttribute('aria-label', 'مشهد ثلاثي الأبعاد قابل للتحديد والتعديل');
    this.renderer.domElement.tabIndex = 0;
    mount.replaceChildren(this.renderer.domElement);

    this.camera.position.set(13, 10, 15);
    this.camera.lookAt(0, 2.3, 0);
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.target.set(0, 2.1, 0);
    this.orbit.minDistance = 4;
    this.orbit.maxDistance = 55;
    this.orbit.maxPolarAngle = Math.PI * 0.49;
    this.transform = new TransformControls(this.camera, this.renderer.domElement);
    this.transform.setSpace('world');
    this.transform.setSize(0.85);
    this.scene.add(this.transform.getHelper());
    this.scene.add(new THREE.HemisphereLight(0xcce6fa, 0x1b2834, 2.0));
    const key = new THREE.DirectionalLight(0xe2f3ff, 3.1);
    key.position.set(9, 15, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x4b9eca, 1.3);
    rim.position.set(-12, 8, -9);
    this.scene.add(rim);
    const grid = new THREE.GridHelper(30, 60, 0x27445a, 0x152b3c);
    grid.position.y = -0.02;
    this.scene.add(grid);
    const origin = new THREE.AxesHelper(1.25);
    origin.position.set(-7, 0.03, -4.5);
    this.scene.add(origin);

    this.renderProject();
    this.bindEvents();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(mount);
    this.ready = this.physics.initialize(this.project).then(() => {
      this.callbacks.onPhysics(this.physics.status, true);
    }).catch((error: unknown) => {
      console.error('Rapier initialization failed', error);
      this.callbacks.onPhysics('تعذر تحميل محرك التصادم WASM؛ التحرير المرئي ما زال يعمل بلا فحص حركة.', false);
    });
    this.animate();
  }

  get currentProject(): MechanicalProject { return this.project; }
  get selectedPart(): StudioPart | null { return this.project.parts.find((part) => part.id === this.selectedId) ?? null; }
  get physicsReady(): boolean { return this.physics.isReady(); }

  setProject(project: MechanicalProject): void {
    this.project = cloneProject(project);
    const keepSelection = this.selectedId && this.project.parts.some((part) => part.id === this.selectedId && part.visible) ? this.selectedId : null;
    this.renderProject();
    this.physics.rebuild(this.project);
    if (keepSelection) this.selectPart(keepSelection);
    else this.selectPart(null);
  }

  selectPart(id: string | null): void {
    if (this.selectedId) this.tintPart(this.parts.get(this.selectedId), false);
    this.selectedId = id;
    const part = id ? this.project.parts.find((item) => item.id === id) : null;
    const object = id ? this.parts.get(id) : null;
    if (part && object && part.visible) {
      this.tintPart(object, true);
      this.transform.attach(object);
      this.dragStartSize = { ...part.sizeMm };
    } else {
      this.transform.detach();
      this.selectedId = null;
      this.dragStartSize = null;
    }
    this.callbacks.onSelect(this.selectedPart);
  }

  setMode(mode: TransformMode): void { this.transform.setMode(mode); }
  get mode(): TransformMode { return this.transform.getMode() as TransformMode; }

  setCamera(mode: 'iso' | 'top' | 'front'): void {
    if (mode === 'top') this.camera.position.set(0, 22, 0.1);
    else if (mode === 'front') this.camera.position.set(0, 5.5, 22);
    else this.camera.position.set(13, 10, 15);
    this.orbit.target.set(0, 2.2, 0);
    this.camera.lookAt(this.orbit.target);
    this.orbit.update();
  }

  resetCamera(): void { this.setCamera('iso'); }

  applyPose(id: string, pose: Pose): boolean {
    const part = this.project.parts.find((item) => item.id === id);
    const object = this.parts.get(id);
    if (!part || !object) return false;
    const previous: Pose = { positionMm: { ...part.positionMm }, rotationDeg: { ...part.rotationDeg } };
    const blocker = this.physics.checkPose(part, previous, pose);
    if (blocker) {
      this.callbacks.onCollision(part, blocker);
      return false;
    }
    part.positionMm = { ...pose.positionMm };
    part.rotationDeg = { ...pose.rotationDeg };
    object.position.copy(toWorld(part.positionMm));
    object.rotation.set(THREE.MathUtils.degToRad(part.rotationDeg.x), THREE.MathUtils.degToRad(part.rotationDeg.y), THREE.MathUtils.degToRad(part.rotationDeg.z), 'XYZ');
    if (part.fixed) this.physics.rebuild(this.project);
    else {
      const constrained = this.physics.moveBody(id, pose);
      if (constrained) {
        part.positionMm = { ...constrained.positionMm };
        part.rotationDeg = { ...constrained.rotationDeg };
        object.position.copy(toWorld(part.positionMm));
        object.rotation.set(THREE.MathUtils.degToRad(part.rotationDeg.x), THREE.MathUtils.degToRad(part.rotationDeg.y), THREE.MathUtils.degToRad(part.rotationDeg.z), 'XYZ');
      }
    }
    this.project.updatedAt = new Date().toISOString();
    this.lastPose.set(id, { positionMm: { ...part.positionMm }, rotationDeg: { ...part.rotationDeg } });
    this.callbacks.onChanged(part, true);
    return true;
  }

  applySize(id: string, sizeMm: Vec3, innerDiameterMm?: number): CollisionHit | null {
    const part = this.project.parts.find((item) => item.id === id);
    if (!part) return null;
    const candidate = { ...part, sizeMm: { x: Math.max(1, sizeMm.x), y: Math.max(1, sizeMm.y), z: Math.max(1, sizeMm.z) }, innerDiameterMm };
    const pose = { positionMm: { ...part.positionMm }, rotationDeg: { ...part.rotationDeg } };
    const collision = this.physics.checkPose(candidate, pose, pose);
    part.sizeMm = candidate.sizeMm;
    part.innerDiameterMm = innerDiameterMm;
    this.project.updatedAt = new Date().toISOString();
    this.renderPart(part);
    this.physics.rebuild(this.project);
    this.selectPart(id);
    this.callbacks.onChanged(part, true);
    if (collision) this.callbacks.onCollision(part, collision);
    return collision;
  }

  setFixed(id: string, fixed: boolean): void {
    const part = this.project.parts.find((item) => item.id === id);
    if (!part) return;
    part.fixed = fixed;
    this.physics.rebuild(this.project);
    this.callbacks.onChanged(part, true);
  }

  setVisibility(id: string, visible: boolean): void {
    const part = this.project.parts.find((item) => item.id === id);
    if (!part) return;
    part.visible = visible;
    const object = this.parts.get(id);
    if (object) object.visible = visible;
    if (!visible && id === this.selectedId) this.selectPart(null);
    this.physics.rebuild(this.project);
    this.callbacks.onChanged(part, true);
  }

  startCanvasRecording(): { done: Promise<Blob>; stop: () => void } {
    const canvas = this.renderer.domElement;
    if (!('captureStream' in canvas) || typeof MediaRecorder === 'undefined') throw new Error('recording unsupported');
    const stream = canvas.captureStream(30);
    const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((candidate) => MediaRecorder.isTypeSupported(candidate));
    if (!mimeType) throw new Error('webm unsupported');
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks: BlobPart[] = [];
    let timer = 0;
    const stop = () => {
      window.clearTimeout(timer);
      if (recorder.state !== 'inactive') recorder.stop();
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      stream.getTracks().forEach((track) => track.stop());
    };
    const done = new Promise<Blob>((resolve, reject) => {
      recorder.addEventListener('dataavailable', (event) => { if (event.data.size) chunks.push(event.data); });
      recorder.addEventListener('error', () => { cleanup(); reject(new Error('recording failed')); }, { once: true });
      recorder.addEventListener('stop', () => { cleanup(); resolve(new Blob(chunks, { type: mimeType })); }, { once: true });
    });
    recorder.start(250);
    timer = window.setTimeout(stop, 30_000);
    return { done, stop };
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.physics.dispose();
    this.orbit.dispose();
    this.transform.dispose();
    this.renderer.dispose();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      }
    });
  }

  private bindEvents(): void {
    this.transform.addEventListener('dragging-changed', (event) => {
      if (event.value) this.callbacks.onBeforeEdit?.();
      this.orbit.enabled = !event.value;
      if (event.value && this.selectedPart) this.dragStartSize = { ...this.selectedPart.sizeMm };
      if (!event.value) this.finishTransform();
    });
    this.transform.addEventListener('objectChange', () => this.onTransformChange());
    this.renderer.domElement.addEventListener('pointerdown', (event) => { this.pointerStart = { x: event.clientX, y: event.clientY }; });
    this.renderer.domElement.addEventListener('pointerup', (event) => {
      if (!this.pointerStart) return;
      const distance = Math.hypot(event.clientX - this.pointerStart.x, event.clientY - this.pointerStart.y);
      this.pointerStart = null;
      if (distance < 6 && !this.transform.dragging) this.pick(event.clientX, event.clientY);
    });
    this.renderer.domElement.addEventListener('dblclick', () => this.resetCamera());
  }

  private pick(clientX: number, clientY: number): void {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((clientX - bounds.left) / bounds.width) * 2 - 1, -((clientY - bounds.top) / bounds.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const visible = Array.from(this.parts.values()).filter((part) => part.visible);
    const hits = this.raycaster.intersectObjects(visible, true);
    const hit = hits[0]?.object;
    let current: THREE.Object3D | null = hit ?? null;
    while (current && !current.userData.partId) current = current.parent;
    const id = current?.userData.partId as string | undefined;
    this.selectPart(id ?? null);
  }

  private onTransformChange(): void {
    const part = this.selectedPart;
    const object = part ? this.parts.get(part.id) : null;
    if (!part || !object) return;
    const previous = this.lastPose.get(part.id) ?? { positionMm: { ...part.positionMm }, rotationDeg: { ...part.rotationDeg } };
    const rotation = object.rotation;
    const pose: Pose = { positionMm: fromWorld(object.position), rotationDeg: { x: THREE.MathUtils.radToDeg(rotation.x), y: THREE.MathUtils.radToDeg(rotation.y), z: THREE.MathUtils.radToDeg(rotation.z) } };
    if (this.transform.getMode() === 'scale' && this.dragStartSize) {
      const candidate = { ...part, sizeMm: { x: this.dragStartSize.x * object.scale.x, y: this.dragStartSize.y * object.scale.y, z: this.dragStartSize.z * object.scale.z } };
      const collision = this.physics.checkPose(candidate, previous, pose);
      if (collision) {
        object.scale.set(1, 1, 1);
        this.callbacks.onCollision(part, collision);
        return;
      }
      part.sizeMm = { ...candidate.sizeMm };
    } else {
      const collision = this.physics.checkPose(part, previous, pose);
      if (collision) {
        object.position.copy(toWorld(previous.positionMm));
        object.rotation.set(THREE.MathUtils.degToRad(previous.rotationDeg.x), THREE.MathUtils.degToRad(previous.rotationDeg.y), THREE.MathUtils.degToRad(previous.rotationDeg.z), 'XYZ');
        this.callbacks.onCollision(part, collision);
        return;
      }
      part.positionMm = { ...pose.positionMm };
      part.rotationDeg = { ...pose.rotationDeg };
      this.lastPose.set(part.id, { positionMm: { ...pose.positionMm }, rotationDeg: { ...pose.rotationDeg } });
    }
    this.project.updatedAt = new Date().toISOString();
    this.callbacks.onChanged(part, false);
  }

  private finishTransform(): void {
    const part = this.selectedPart;
    if (!part) return;
    const group = this.parts.get(part.id);
    if (group && this.transform.getMode() === 'scale') {
      group.scale.set(1, 1, 1);
      this.renderPart(part);
      this.selectPart(part.id);
    }
    this.physics.rebuild(this.project);
    this.physics.moveBody(part.id, { positionMm: part.positionMm, rotationDeg: part.rotationDeg });
    this.callbacks.onChanged(part, true);
  }

  private renderProject(): void {
    for (const group of this.parts.values()) this.scene.remove(group);
    this.parts.clear();
    for (const part of this.project.parts) this.renderPart(part);
    this.selectedId = null;
    this.transform.detach();
  }

  private renderPart(part: StudioPart): void {
    const old = this.parts.get(part.id);
    if (old) {
      this.scene.remove(old);
      old.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
    }
    const group = buildPartObject(part);
    group.position.copy(toWorld(part.positionMm));
    group.rotation.set(THREE.MathUtils.degToRad(part.rotationDeg.x), THREE.MathUtils.degToRad(part.rotationDeg.y), THREE.MathUtils.degToRad(part.rotationDeg.z), 'XYZ');
    group.visible = part.visible;
    group.userData.partId = part.id;
    group.name = part.name;
    this.scene.add(group);
    this.parts.set(part.id, group);
    if (this.selectedId === part.id) this.tintPart(group, true);
  }

  private tintPart(group: THREE.Group | undefined, selected: boolean): void {
    if (!group) return;
    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => {
        if (material instanceof THREE.MeshStandardMaterial) {
          material.emissive.set(selected ? '#17415a' : '#000000');
          material.emissiveIntensity = selected ? 0.75 : 0;
          material.needsUpdate = true;
        }
      });
    });
  }

  private resize(): void {
    const width = Math.max(1, this.mount.clientWidth);
    const height = Math.max(1, this.mount.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  }

  private animate = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.animate);
    this.orbit.update();
    this.renderer.render(this.scene, this.camera);
  };
}

function buildPartObject(part: StudioPart): THREE.Group {
  const group = new THREE.Group();
  const x = part.sizeMm.x * WORLD_PER_MM;
  const y = part.sizeMm.y * WORLD_PER_MM;
  const z = part.sizeMm.z * WORLD_PER_MM;
  const color = new THREE.Color(part.color);
  const material = new THREE.MeshStandardMaterial({ color, metalness: 0.42, roughness: 0.48, emissive: '#000000' });
  const accent = new THREE.MeshStandardMaterial({ color: color.clone().lerp(new THREE.Color('#d6e7f2'), 0.22), metalness: 0.55, roughness: 0.34, emissive: '#000000' });
  const addBox = (sizeX: number, sizeY: number, sizeZ: number, position: Vec3 = { x: 0, y: 0, z: 0 }, mat = material) => {
    const geometry = new THREE.BoxGeometry(Math.max(0.01, sizeX), Math.max(0.01, sizeY), Math.max(0.01, sizeZ));
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.set(position.x, position.y, position.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.partId = part.id;
    group.add(mesh);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: '#c8d7e3', transparent: true, opacity: 0.22 }));
    edge.position.copy(mesh.position);
    edge.userData.partId = part.id;
    group.add(edge);
  };
  const addCylinder = (radiusTop: number, radiusBottom: number, height: number, mat = material, openEnded = false) => {
    const geometry = new THREE.CylinderGeometry(Math.max(0.005, radiusTop), Math.max(0.005, radiusBottom), Math.max(0.012, height), 36, 1, openEnded);
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.partId = part.id;
    group.add(mesh);
    return mesh;
  };

  if (part.kind === 'u-channel') {
    const wall = Math.max(0.035, Math.min(y, z) * 0.12);
    const innerHeight = Math.max(0.03, y - wall);
    addBox(x, wall, z, { x: 0, y: -y / 2 + wall / 2, z: 0 });
    addBox(x, innerHeight, wall, { x: 0, y: wall / 2, z: z / 2 - wall / 2 }, accent);
    addBox(x, innerHeight, wall, { x: 0, y: wall / 2, z: -z / 2 + wall / 2 }, accent);
  } else if (part.kind === 'tube') {
    const wall = Math.max(0.025, Math.min(x, z) * 0.1);
    addBox(wall, y, z, { x: -x / 2 + wall / 2, y: 0, z: 0 }, accent);
    addBox(wall, y, z, { x: x / 2 - wall / 2, y: 0, z: 0 }, accent);
    addBox(x - 2 * wall, y, wall, { x: 0, y: 0, z: z / 2 - wall / 2 }, material);
  } else if (part.kind === 'cylinder') {
    addBox(x * 0.64, y, z, { x: -x * 0.12, y: 0, z: 0 }, accent);
    addBox(x * 0.42, y * 0.28, z * 0.28, { x: x * 0.36, y: 0, z: 0 }, material);
  } else if (part.kind === 'shaft') {
    const body = addCylinder(z / 2, z / 2, y, material);
    body.rotation.z = Math.PI / 2;
    body.scale.x = x / Math.max(y, 0.01);
  } else if (part.kind === 'cap') {
    const radius = Math.max(0.025, Math.min(x, z) / 2);
    const outer = addCylinder(radius, radius, y, material, true);
    const innerDiameter = Math.min(part.innerDiameterMm ?? Math.min(part.sizeMm.x, part.sizeMm.z) * 0.68, Math.min(part.sizeMm.x, part.sizeMm.z) - 2);
    const innerRadius = Math.max(0.015, innerDiameter * WORLD_PER_MM / 2);
    const inner = addCylinder(innerRadius, innerRadius, Math.max(0.01, y * 0.72), new THREE.MeshStandardMaterial({ color: '#0c1822', metalness: 0.1, roughness: 0.92 }), true);
    inner.position.y = y * 0.12;
    const floor = addCylinder(innerRadius, innerRadius, Math.max(0.01, y * 0.08), accent);
    floor.position.y = -y * 0.36;
    outer.userData.partId = part.id;
  } else if (part.kind === 'washer') {
    const shape = new THREE.Shape();
    const radius = Math.min(x, z) / 2;
    const innerRadius = Math.min(radius * 0.88, Math.max(0.005, (part.innerDiameterMm ?? Math.min(part.sizeMm.x, part.sizeMm.z) * 0.45) * WORLD_PER_MM / 2));
    shape.absarc(0, 0, radius, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, innerRadius, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.008, y), bevelEnabled: false, steps: 1 });
    geometry.rotateX(Math.PI / 2);
    geometry.translate(0, y / 2, 0);
    const mesh = new THREE.Mesh(geometry, accent);
    mesh.castShadow = true;
    mesh.userData.partId = part.id;
    group.add(mesh);
  } else if (part.kind === 'gear-blank') {
    addCylinder(Math.min(x, z) / 2, Math.min(x, z) / 2, y, accent);
  } else {
    addBox(x, y, z, { x: 0, y: 0, z: 0 }, material);
    if (part.kind === 'slider') addBox(x * 0.65, y * 0.12, z * 0.78, { x: 0, y: y * 0.56, z: 0 }, accent);
  }
  return group;
}
