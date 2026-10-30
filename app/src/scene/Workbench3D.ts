import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { DesignState, LayoutMode } from '../model/project';

const COLORS = {
  dark: 0x172433,
  base: 0x26384a,
  steel: 0x91a9bd,
  steelLight: 0xc7d7e5,
  blue: 0x39a9e8,
  blueDark: 0x176b9d,
  yellow: 0xf4bd4f,
  orange: 0xef9147,
  plastic: 0x456a86,
  cap: 0x3e7893,
  black: 0x0b111a,
  green: 0x49c78b,
};

interface ModelDimensions {
  diameter: number;
  innerDiameter: number;
  capHeight: number;
  washerDiameter: number;
  washerInnerDiameter: number;
  washerThickness: number;
  channelWidth: number;
  channelHeight: number;
  length: number;
  baseWidth: number;
  baseLength: number;
  baseHeight: number;
  railY: number;
  washerX: number;
  washerZ: number;
  pickupZ: number;
  pressX: number;
  capPusherStroke: number;
  washerSlideStroke: number;
  pressStroke: number;
}

export class Workbench3D {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  private readonly mount: HTMLElement;
  private readonly root = new THREE.Group();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private resizeObserver: ResizeObserver;
  private onPartSelected: (partId: string) => void;
  private design: DesignState;
  private layout: LayoutMode;
  private dimensions!: ModelDimensions;
  private selectedPart: string | null = null;
  private partObjects: THREE.Object3D[] = [];
  private readonly hiddenParts = new Set<string>();
  private caps = new THREE.Group();
  private pusherRod?: THREE.Object3D;
  private glueNeedle?: THREE.Object3D;
  private glueDrop?: THREE.Object3D;
  private slideGroup?: THREE.Group;
  private transferHead?: THREE.Group;
  private movingWasher?: THREE.Object3D;
  private pressPlate?: THREE.Object3D;
  private currentPhase = 'safety';
  private currentProgress = 0;
  private frameId = 0;

  constructor(mount: HTMLElement, design: DesignState, onPartSelected: (partId: string) => void) {
    this.mount = mount;
    this.design = design;
    this.layout = design.layout;
    this.onPartSelected = onPartSelected;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0c1520);
    this.scene.fog = new THREE.Fog(0x0c1520, 18, 36);
    this.scene.add(this.root);

    const width = Math.max(mount.clientWidth, 1);
    const height = Math.max(mount.clientHeight, 1);
    this.camera = new THREE.PerspectiveCamera(38, width / height, 0.05, 5000);
    this.camera.position.set(8.7, 7.2, 10.8);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
    this.renderer.setSize(width, height);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute('aria-label', 'نموذج ثلاثي الأبعاد تفاعلي للماكينة؛ اسحب للدوران، واستخدم عجلة الفأرة للتقريب');
    this.mount.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1.15, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 24;
    this.controls.maxPolarAngle = Math.PI * 0.49;

    const hemi = new THREE.HemisphereLight(0xc7e5ff, 0x172233, 2.1);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xfff3dd, 3.3);
    key.position.set(-5, 12, 7);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -12;
    key.shadow.camera.right = 12;
    key.shadow.camera.top = 12;
    key.shadow.camera.bottom = -12;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x62baff, 1.35);
    rim.position.set(8, 5, -8);
    this.scene.add(rim);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshStandardMaterial({ color: 0x0c1520, roughness: 0.92 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.08;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const grid = new THREE.GridHelper(34, 68, 0x2d5068, 0x213449);
    grid.position.y = -0.055;
    const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
    gridMaterials.forEach((material) => { material.transparent = true; material.opacity = 0.43; });
    this.scene.add(grid);

    this.renderer.domElement.addEventListener('pointerup', this.handlePick);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.mount);
    this.build();
    this.resetCamera();
    this.animate();
  }

  private readonly handlePick = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.partObjects, true);
    const hit = hits.find((entry) => entry.object.visible);
    if (!hit) return;
    let object: THREE.Object3D | null = hit.object;
    while (object && !object.userData.partId) object = object.parent;
    const id = object?.userData.partId as string | undefined;
    if (id) {
      this.highlightPart(id);
      this.onPartSelected(id);
    }
  };

  private resize() {
    const width = Math.max(this.mount.clientWidth, 1);
    const height = Math.max(this.mount.clientHeight, 1);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  updateDesign(design: DesignState) {
    this.design = design;
    this.layout = design.layout;
    this.rebuildPreservingCamera();
  }

  setLayout(layout: LayoutMode) {
    this.layout = layout;
    this.design.layout = layout;
    this.rebuildPreservingCamera();
  }

  private rebuildPreservingCamera() {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const direction = offset.lengthSq() > 0 ? offset.normalize() : new THREE.Vector3(1, 0.6, 1).normalize();
    this.build();
    const center = new THREE.Vector3(0, 1.05, 0);
    const distance = Math.max(this.dimensions.length * 1.2, this.dimensions.baseLength * 1.12, this.dimensions.baseWidth * 1.5, 6);
    this.controls.target.copy(center);
    this.controls.minDistance = Math.max(0.35, distance * 0.08);
    this.controls.maxDistance = Math.max(24, distance * 3.2);
    this.camera.far = Math.max(100, distance * 12);
    this.camera.position.copy(center).add(direction.multiplyScalar(distance));
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  setSelectedPart(partId: string | null) {
    this.highlightPart(partId ?? '');
  }

  isPartHidden(partId: string) {
    return this.hiddenParts.has(partId);
  }

  togglePartVisibility(partId: string) {
    if (this.hiddenParts.has(partId)) this.hiddenParts.delete(partId);
    else this.hiddenParts.add(partId);
    this.applyHiddenParts();
    return this.hiddenParts.has(partId);
  }

  private applyHiddenParts() {
    this.partObjects.forEach((object) => {
      const partId = object.userData.partId as string | undefined;
      if (partId) object.visible = !this.hiddenParts.has(partId);
    });
  }

  private highlightPart(partId: string) {
    if (this.selectedPart) {
      this.partObjects.filter((object) => object.userData.partId === this.selectedPart).forEach((object) => {
        const material = (object as THREE.Mesh).material;
        const materials = Array.isArray(material) ? material : [material];
        materials.forEach((entry) => {
          if (entry instanceof THREE.MeshStandardMaterial && entry.userData.originalEmissive !== undefined) {
            entry.emissive.setHex(entry.userData.originalEmissive as number);
            entry.emissiveIntensity = 0.12;
          }
        });
      });
    }
    this.selectedPart = partId || null;
    if (!partId) return;
    this.partObjects.filter((object) => object.userData.partId === partId).forEach((object) => {
      const material = (object as THREE.Mesh).material;
      const materials = Array.isArray(material) ? material : [material];
      materials.forEach((entry) => {
        if (entry instanceof THREE.MeshStandardMaterial) {
          if (entry.userData.originalEmissive === undefined) entry.userData.originalEmissive = entry.emissive.getHex();
          entry.emissive.setHex(0x1e78a7);
          entry.emissiveIntensity = 0.5;
        }
      });
    });
  }

  setCamera(mode: 'iso' | 'top' | 'front') {
    const center = new THREE.Vector3(0, 1.05, 0);
    const distance = Math.max(this.dimensions.length * 1.18, this.dimensions.baseLength * 1.1, this.dimensions.baseWidth * 1.48, 6);
    this.controls.minDistance = Math.max(0.35, distance * 0.08);
    this.controls.maxDistance = Math.max(24, distance * 3.2);
    this.camera.far = Math.max(100, distance * 12);
    this.camera.updateProjectionMatrix();
    if (mode === 'top') this.camera.position.set(center.x, center.y + distance * 1.1, center.z + 0.001);
    else if (mode === 'front') this.camera.position.set(center.x, center.y + distance * 0.26, distance * 0.9);
    else this.camera.position.set(distance * 0.62, center.y + distance * 0.54, distance * 0.78);
    this.controls.target.copy(center);
    this.controls.update();
  }

  resetCamera() {
    this.setCamera('iso');
  }

  setCycle(phase: string, progress: number) {
    this.currentPhase = phase;
    this.currentProgress = THREE.MathUtils.clamp(progress, 0, 1);
  }

  private animate = () => {
    this.frameId = requestAnimationFrame(this.animate);
    this.controls.update();
    this.applyCycle(this.currentPhase, this.currentProgress);
    this.renderer.render(this.scene, this.camera);
  };

  private addMesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, position: THREE.Vector3, partId: string, castShadow = true) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.userData.partId = partId;
    parent.add(mesh);
    this.partObjects.push(mesh);
    return mesh;
  }

  private addBox(parent: THREE.Object3D, size: [number, number, number], position: [number, number, number], color: number, partId: string, options: { metalness?: number; roughness?: number; transparent?: boolean; opacity?: number } = {}) {
    const geometry = new THREE.BoxGeometry(...size);
    const material = new THREE.MeshStandardMaterial({
      color,
      metalness: options.metalness ?? 0.65,
      roughness: options.roughness ?? 0.34,
      transparent: options.transparent ?? false,
      opacity: options.opacity ?? 1,
      emissive: 0x07101a,
      emissiveIntensity: 0.12,
    });
    return this.addMesh(parent, geometry, material, new THREE.Vector3(...position), partId);
  }

  private addCylinder(parent: THREE.Object3D, radiusTop: number, radiusBottom: number, height: number, position: [number, number, number], color: number, partId: string, options: { radial?: number; open?: boolean; roughness?: number; metalness?: number; transparent?: boolean; opacity?: number } = {}) {
    const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, options.radial ?? 28, 1, options.open ?? false);
    const material = new THREE.MeshStandardMaterial({
      color,
      metalness: options.metalness ?? 0.5,
      roughness: options.roughness ?? 0.38,
      transparent: options.transparent ?? false,
      opacity: options.opacity ?? 1,
      side: options.open ? THREE.DoubleSide : THREE.FrontSide,
      emissive: 0x07101a,
      emissiveIntensity: 0.1,
    });
    return this.addMesh(parent, geometry, material, new THREE.Vector3(...position), partId);
  }

  private addLabel(text: string, position: [number, number, number], color = '#e7f1f7') {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(9,18,29,0.91)';
    ctx.beginPath();
    ctx.roundRect(16, 16, 480, 96, 24);
    ctx.fill();
    ctx.strokeStyle = 'rgba(101,165,207,0.65)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = 'bold 35px Tahoma, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.direction = 'rtl';
    ctx.fillText(text, 256, 65, 450);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, sizeAttenuation: true }));
    sprite.position.set(...position);
    sprite.scale.set(1.22, 0.31, 1);
    sprite.renderOrder = 10;
    this.root.add(sprite);
  }

  private setPart(group: THREE.Group, id: string, position: [number, number, number] = [0, 0, 0]) {
    group.position.set(...position);
    group.userData.partId = id;
    this.root.add(group);
    return group;
  }

  private build() {
    this.disposeRoot();
    this.partObjects = [];
    const m = this.design.measurements;
    const mm = (value: number) => value / 100;
    const diameter = m.capOuterDiameter ? mm(m.capOuterDiameter) : 0.52;
    const innerDiameter = m.capInnerDiameter ? mm(m.capInnerDiameter) : diameter * 0.84;
    const capHeight = m.capHeight ? mm(m.capHeight) : diameter * 0.36;
    const washerDiameter = m.washerDiameter ? mm(m.washerDiameter) : diameter * 0.88;
    const washerInnerDiameter = m.washerInnerDiameter ? mm(m.washerInnerDiameter) : washerDiameter * 0.3;
    const washerThickness = m.washerThickness ? mm(m.washerThickness) : diameter * 0.055;
    const channelWidth = m.channelInnerWidth ? mm(m.channelInnerWidth) : m.capOuterDiameter && m.channelClearancePerSide ? diameter + 2 * mm(m.channelClearancePerSide) : diameter * 1.42;
    const channelHeight = m.channelWallHeight ? mm(m.channelWallHeight) : diameter * 0.34;
    const length = m.channelLength ? mm(m.channelLength) : Math.max(6.4, diameter * 15.5);
    const baseHeight = Math.max(0.22, diameter * 0.45);
    const railY = baseHeight + 0.18;
    const sideOffset = channelWidth * 1.82;
    const pressX = Math.min(length * 0.24, length / 2 - diameter * 1.1);
    const washerX = this.layout === 'L' ? pressX + diameter * 2.25 : pressX;
    const washerZ = this.layout === 'U' ? -sideOffset : sideOffset;
    const washerSlideStroke = m.washerSlideStroke ? mm(m.washerSlideStroke) : Math.abs(sideOffset) * 0.24;
    const pickupZ = washerZ - Math.sign(washerZ) * washerSlideStroke;
    const capPusherStroke = m.capPusherStroke ? mm(m.capPusherStroke) : diameter * 0.82;
    const pressStroke = m.pressStroke ? mm(m.pressStroke) : diameter * 1.12;
    const suggestedBaseWidth = Math.max(channelWidth * 4.3, Math.abs(washerZ) * 2 + diameter * 3.3, diameter * 7.2);
    const baseWidth = m.workAreaWidth ? mm(m.workAreaWidth) : suggestedBaseWidth;
    const estimatedBaseLength = Math.max(length + 0.7, washerX + diameter * 2.2);
    const baseLength = m.workAreaDepth ? mm(m.workAreaDepth) : estimatedBaseLength;
    this.dimensions = { diameter, innerDiameter, capHeight, washerDiameter, washerInnerDiameter, washerThickness, channelWidth, channelHeight, length, baseWidth, baseLength, baseHeight, railY, washerX, washerZ, pickupZ, pressX, capPusherStroke, washerSlideStroke, pressStroke };

    this.makeFrame();
    this.makeCapFeed();
    this.makeChannelAndCaps();
    this.makeGlueStation();
    this.makeWasherFeed();
    this.makeTransferHead();
    this.makePneumaticPanel();
    this.makeOutputZone();
    this.addLabel(this.layout === 'linear' ? 'ترتيب خطي' : this.layout === 'L' ? 'ترتيب المحطات L' : 'ترتيب المحطات U', [0, this.dimensions.baseHeight + 2.8, 0], '#8ed3ff');
    this.applyHiddenParts();
    this.highlightPart(this.selectedPart ?? '');
    this.applyCycle(this.currentPhase, this.currentProgress);
  }

  private disposeRoot() {
    for (const child of [...this.root.children]) {
      this.root.remove(child);
      child.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Sprite) {
          object.geometry?.dispose();
          const material = (object as THREE.Mesh).material;
          if (Array.isArray(material)) material.forEach((item) => item.dispose());
          else if (material) material.dispose();
          if (object instanceof THREE.Sprite) {
            const texture = (object.material as THREE.SpriteMaterial).map;
            texture?.dispose();
          }
        }
      });
    }
  }

  private makeFrame() {
    const { length, baseWidth, baseLength, baseHeight } = this.dimensions;
    const id = 'frame';
    const frame = this.setPart(new THREE.Group(), id);
    const footY = baseHeight * 0.5;
    this.addBox(frame, [baseLength, baseHeight, baseWidth], [0, footY, 0], COLORS.base, id, { metalness: 0.72, roughness: 0.4 });
    const topY = baseHeight + Math.max(2.4, this.dimensions.diameter * 5.5);
    const postW = Math.max(0.13, this.dimensions.diameter * 0.25);
    const endX = baseLength * 0.47;
    for (const x of [-endX, endX]) {
      for (const z of [-baseWidth * 0.46, baseWidth * 0.46]) {
        this.addBox(frame, [postW, topY - baseHeight + 0.2, postW], [x, (topY + baseHeight) / 2, z], COLORS.steel, id, { metalness: 0.8, roughness: 0.26 });
        this.addBox(frame, [postW * 1.8, 0.07, postW * 1.8], [x, baseHeight + 0.04, z], COLORS.steelLight, id);
      }
    }
    this.addBox(frame, [baseLength * 0.94, postW * 1.35, postW * 1.35], [0, topY, -baseWidth * 0.46], COLORS.steel, id);
    this.addBox(frame, [baseLength * 0.94, postW * 1.35, postW * 1.35], [0, topY, baseWidth * 0.46], COLORS.steel, id);
    this.addBox(frame, [postW * 1.2, postW, baseWidth * 0.92], [-endX, topY, 0], COLORS.steelLight, id);
    this.addBox(frame, [postW * 1.2, postW, baseWidth * 0.92], [endX, topY, 0], COLORS.steelLight, id);
    this.addLabel('شاسيه / قطاعه وأحماله غير محددة', [0, topY + 0.47, -baseWidth * 0.46], '#f4cc76');
    if (this.layout !== 'linear') {
      const isL = this.layout === 'L';
      const wingZ = isL ? this.dimensions.washerZ * 0.58 : -baseWidth * 0.39;
      const wingX = isL ? (this.dimensions.pressX + this.dimensions.washerX) * 0.5 : length * 0.22;
      const wingLength = isL ? Math.max(1.2, Math.abs(this.dimensions.washerX - this.dimensions.pressX) + this.dimensions.diameter * 1.7) : Math.max(1.2, baseWidth * 0.34);
      this.addBox(frame, [wingLength, 0.09, postW * 1.2], [wingX, baseHeight + 0.16, wingZ], COLORS.blueDark, id, { metalness: 0.48, roughness: 0.47 });
      this.addLabel(isL ? 'ذراع تغذية جانبي L' : 'ذراع حيز المحطات U', [wingX, baseHeight + 0.65, wingZ], '#92d4f7');
    }
  }

  private makeCapFeed() {
    const { diameter: d, innerDiameter, capHeight: h, length, railY, baseWidth } = this.dimensions;
    const id = 'capMagazine';
    const magazine = this.setPart(new THREE.Group(), id);
    const x = -length * 0.39;
    const z = 0;
    const tubeR = d * 0.61;
    const tubeH = Math.max(1.5, h * 3.4);
    this.addCylinder(magazine, tubeR, tubeR, tubeH, [x, railY + tubeH * 0.5, z], 0x83c9e8, id, { open: true, transparent: true, opacity: 0.25, metalness: 0.15, roughness: 0.18 });
    this.addCylinder(magazine, tubeR + 0.025, tubeR + 0.025, 0.06, [x, railY + tubeH, z], COLORS.steelLight, id, { open: true });
    for (let i = 0; i < 3; i++) this.makeCap(magazine, x, railY + h * 0.5 + i * h * 0.76, z, d, h, id, 0.84, innerDiameter);
    const pusherX = x - d * 1.16;
    const pusher = this.setPart(new THREE.Group(), 'capPusher');
    this.addCylinder(pusher, d * 0.2, d * 0.2, d * 2.45, [pusherX - d * 0.55, railY + h * 0.5, z], COLORS.steel, 'capPusher', { metalness: 0.76, roughness: 0.28 }).rotation.z = Math.PI / 2;
    const rod = this.addCylinder(pusher, d * 0.07, d * 0.07, d * 1.05, [pusherX + d * 0.5, railY + h * 0.5, z], COLORS.steelLight, 'capPusher', { metalness: 0.82, roughness: 0.22 });
    rod.rotation.z = Math.PI / 2;
    this.pusherRod = rod;
    this.addBox(pusher, [d * 0.16, h * 0.62, d * 0.86], [pusherX + d, railY + h * 0.5, z], COLORS.blue, 'capPusher', { metalness: 0.22, roughness: 0.42 });
    this.addLabel('مخزن الأغطية · السعة غير محددة', [x, railY + tubeH + 0.28, z], '#bfe6f9');
    this.addLabel('بستم دفع الصف واحد', [pusherX, railY + h + 0.4, z - baseWidth * 0.06], '#f4cc76');
  }

  private makeChannelAndCaps() {
    const { length, channelWidth: width, channelHeight: wallH, railY, baseHeight, diameter: d, innerDiameter, capHeight: h, pressX } = this.dimensions;
    const id = 'channel';
    const channel = this.setPart(new THREE.Group(), id);
    const t = Math.max(0.045, Math.min(width * 0.085, 0.11));
    const run = length * 0.94;
    const capY = railY + h * 0.5;
    this.addBox(channel, [run, 0.13, width + t * 2], [0, railY - 0.06, 0], 0x677f91, id, { metalness: 0.82, roughness: 0.29 });
    for (const z of [-(width / 2 + t / 2), width / 2 + t / 2]) {
      this.addBox(channel, [run, wallH, t], [0, railY + wallH / 2, z], COLORS.steel, id, { metalness: 0.78, roughness: 0.3 });
      this.addBox(channel, [run, 0.055, t * 1.08], [0, railY + wallH, z], COLORS.steelLight, id, { metalness: 0.82, roughness: 0.24 });
    }
    this.addBox(channel, [run, 0.07, width * 0.48], [0, baseHeight + 0.04, 0], COLORS.dark, id, { metalness: 0.55, roughness: 0.41 });

    this.caps = this.setPart(new THREE.Group(), 'cap');
    const startX = -length * 0.38 + d * 1.65;
    for (let i = 0; i < 4; i++) this.makeCap(this.caps, startX + i * d * 1.04, capY, 0, d, h, 'cap', 1, innerDiameter);
    this.pressX = pressX;
    this.addLabel('مجرى U · قيمة العرض من إدخالك', [0, railY + wallH + 0.25, -width * 0.5 - t], '#cfe2f1');
    this.addLabel('4 أغطية مرسومة للتوضيح فقط', [startX + d * 1.5, railY + wallH + 0.35, width * 0.5 + 0.3], '#f4cc76');
  }

  private pressX = 0;

  private makeCap(parent: THREE.Object3D, x: number, centerY: number, z: number, diameter: number, height: number, partId: string, opacity = 1, innerDiameter = diameter * 0.84) {
    const group = new THREE.Group();
    group.position.set(x, centerY, z);
    group.userData.partId = partId;
    parent.add(group);
    this.partObjects.push(group);
    const r = diameter / 2;
    const side = new THREE.MeshStandardMaterial({ color: COLORS.cap, metalness: 0.22, roughness: 0.38, transparent: opacity < 1, opacity, side: THREE.DoubleSide, emissive: 0x07101a, emissiveIntensity: 0.1 });
    const wall = this.addMesh(group, new THREE.CylinderGeometry(r, r * 0.99, height, 36, 1, true), side, new THREE.Vector3(0, 0, 0), partId);
    wall.castShadow = true;
    const innerRadius = Math.min(r * 0.96, Math.max(r * 0.25, innerDiameter * 0.5));
    const inside = this.addCylinder(group, innerRadius, innerRadius, Math.max(height * 0.04, 0.012), [0, height * 0.34, 0], 0x101b28, partId, { metalness: 0.14, roughness: 0.68 });
    inside.castShadow = false;
    const bottom = this.addCylinder(group, r * 0.95, r, Math.max(height * 0.075, 0.02), [0, -height * 0.43, 0], 0x335e73, partId, { metalness: 0.2, roughness: 0.44 });
    bottom.castShadow = true;
    const lip = this.addCylinder(group, r * 1.045, r * 0.98, Math.max(height * 0.07, 0.02), [0, height * 0.45, 0], 0x79a9bd, partId, { metalness: 0.48, roughness: 0.29, open: true });
    lip.castShadow = false;
    return group;
  }

  private makeGlueStation() {
    const { length, diameter: d, railY, capHeight: h } = this.dimensions;
    const id = 'glueUnit';
    const x = -length * 0.02;
    const y = railY + h + d * 1.7;
    const glue = this.setPart(new THREE.Group(), id);
    this.addBox(glue, [d * 0.85, d * 0.52, d * 0.72], [x, y + d * 0.47, 0], COLORS.dark, id, { metalness: 0.63, roughness: 0.35 });
    const needle = this.addCylinder(glue, d * 0.09, d * 0.045, d * 0.76, [x, y, 0], COLORS.steelLight, id, { radial: 20, metalness: 0.78, roughness: 0.23 });
    this.glueNeedle = needle;
    const bead = this.addCylinder(glue, d * 0.09, d * 0.12, d * 0.12, [x, railY + h * 0.98, 0], COLORS.yellow, id, { radial: 20, metalness: 0.12, roughness: 0.21 });
    bead.visible = false;
    this.glueDrop = bead;
    this.addLabel('وحدة الغراء · النوع والجرعة مفتوحان', [x, y + d * 1.2, 0], '#f4cc76');
  }

  private makeWasherFeed() {
    const { washerDiameter: wd, washerInnerDiameter: innerD, washerThickness: wt, diameter: d, washerX, washerZ, pickupZ, railY, baseWidth } = this.dimensions;
    const id = 'washerMagazine';
    const r = wd * 0.5;
    const washer = this.setPart(new THREE.Group(), id, [washerX, 0, washerZ]);
    this.addCylinder(washer, r * 1.06, r * 1.06, d * 2.1, [0, railY + d * 1.06, 0], 0x76b8d7, id, { open: true, transparent: true, opacity: 0.19, metalness: 0.18, roughness: 0.18 });
    for (let i = 0; i < 3; i++) this.makeWasher(washer, 0, railY + wt * 0.5 + i * wt * 1.15, 0, wd, innerD, wt, id, 0.8);
    this.addLabel('مخزن الروندلة · اتجاه/سعة غير محددين', [washerX, railY + d * 2.5, washerZ], '#bfe6f9');

    this.slideGroup = this.setPart(new THREE.Group(), 'transferSlide', [washerX, railY + wt * 0.6, 0]);
    const plateW = Math.max(d * 1.6, wd * 1.35);
    this.addBox(this.slideGroup, [plateW, Math.max(0.07, d * 0.14), Math.abs(washerZ) + plateW], [0, 0, washerZ * 0.5], COLORS.blueDark, 'transferSlide', { metalness: 0.44, roughness: 0.37 });
    this.addCylinder(this.slideGroup, r * 0.94, r * 0.94, Math.max(wt * 0.45, 0.025), [0, 0.1, washerZ], COLORS.yellow, 'transferSlide', { metalness: 0.17, roughness: 0.35 });
    this.addLabel('جيب واحد · هندسته تحتاج اختبارًا', [washerX, railY + d * 0.55, pickupZ * 0.66], '#f4cc76');

    this.movingWasher = this.makeWasher(this.root, washerX, railY + wt * 0.7, washerZ, wd, innerD, wt, 'washer', 1);
    this.addLabel('لسان سحاب', [washerX + d * 1.7, railY + d * 0.7, pickupZ], '#91d3f8');
    if (this.layout !== 'linear') {
      const wingZ = this.layout === 'L' ? baseWidth * 0.38 : -baseWidth * 0.38;
      this.addBox(this.root, [d * 2.7, 0.06, Math.abs(wingZ) * 0.78], [washerX, railY - d * 0.35, wingZ * 0.48], COLORS.base, 'washerMagazine', { metalness: 0.54, roughness: 0.45 });
    }
  }

  private makeWasher(parent: THREE.Object3D, x: number, y: number, z: number, diameter: number, innerDiameter: number, thickness: number, partId: string, opacity: number) {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.userData.partId = partId;
    parent.add(group);
    this.partObjects.push(group);
    const r = diameter / 2;
    const innerR = Math.min(r * 0.88, Math.max(r * 0.08, innerDiameter / 2));
    const mat = new THREE.MeshStandardMaterial({ color: 0xb7c8d3, metalness: 0.28, roughness: 0.47, transparent: opacity < 1, opacity, side: THREE.DoubleSide, emissive: 0x08111b, emissiveIntensity: 0.08 });
    const profile = new THREE.Shape();
    profile.absarc(0, 0, r, 0, Math.PI * 2, false);
    const opening = new THREE.Path();
    opening.absarc(0, 0, innerR, 0, Math.PI * 2, true);
    profile.holes.push(opening);
    const ring = new THREE.ExtrudeGeometry(profile, { depth: thickness, bevelEnabled: false, curveSegments: 48, steps: 1 });
    ring.translate(0, 0, -thickness / 2);
    const ringMesh = this.addMesh(group, ring, mat, new THREE.Vector3(), partId);
    ringMesh.rotation.x = -Math.PI / 2;
    return group;
  }

  private makeTransferHead() {
    const { diameter: d, capHeight: h, railY, washerX, washerZ, pickupZ, pressX, baseWidth } = this.dimensions;
    const id = 'vacuumPressHead';
    const topY = railY + h + d * 3.15;
    const headRail = this.setPart(new THREE.Group(), id);
    const spanZ = Math.abs(washerZ) + d * 1.25;
    this.addBox(headRail, [d * 0.38, d * 0.33, spanZ], [pressX, topY + d * 0.55, washerZ * 0.5], COLORS.steel, id, { metalness: 0.8, roughness: 0.26 });
    for (const z of [0, washerZ]) {
      this.addBox(headRail, [d * 0.3, topY - railY + h * 0.3, d * 0.3], [pressX, (topY + railY + h * 0.3) * 0.5, z], COLORS.steel, id, { metalness: 0.77, roughness: 0.29 });
    }
    if (this.layout === 'L') {
      const spanX = Math.abs(washerX - pressX) + d * 0.9;
      this.addBox(headRail, [spanX, d * 0.3, d * 0.3], [(washerX + pressX) * 0.5, topY + d * 0.55, washerZ], COLORS.steelLight, id, { metalness: 0.77, roughness: 0.29 });
    }
    this.transferHead = new THREE.Group();
    this.transferHead.position.set(washerX, topY, pickupZ);
    this.transferHead.userData.partId = id;
    headRail.add(this.transferHead);
    this.partObjects.push(this.transferHead);
    this.addCylinder(this.transferHead, d * 0.38, d * 0.38, d * 1.36, [0, -d * 0.48, 0], COLORS.blue, id, { metalness: 0.45, roughness: 0.34 });
    this.addCylinder(this.transferHead, d * 0.34, d * 0.33, d * 0.18, [0, -d * 1.18, 0], 0xd2dfe7, id, { metalness: 0.74, roughness: 0.28 });
    this.addCylinder(this.transferHead, d * 0.14, d * 0.09, d * 0.2, [0, -d * 1.36, 0], COLORS.black, id, { metalness: 0.08, roughness: 0.6 });
    this.addLabel('التقاط + كبس؟ · ترتيب الرأس مفتوح', [pressX + d * 1.4, topY + d * 0.55, washerZ * 0.45], '#f4cc76');
    if (this.design.headMode === 'separate') {
      const separate = this.setPart(new THREE.Group(), 'vacuumPressHead', [pressX + d * 1.55, 0, 0]);
      this.addCylinder(separate, d * 0.29, d * 0.29, d * 1.2, [0, topY - d * 0.43, 0], COLORS.orange, id, { metalness: 0.4, roughness: 0.38 });
      this.addCylinder(separate, d * 0.23, d * 0.25, d * 0.14, [0, topY - d * 1.1, 0], COLORS.steelLight, id, { metalness: 0.7, roughness: 0.25 });
      this.addLabel('خيار تصوري: وحدة منفصلة', [pressX + d * 1.55, topY + d * 0.75, 0], '#ffc38e');
    }
    if (this.layout === 'U') this.addLabel('شكل الترتيب لا يغيّر مبدأ دفع الصف', [0, railY + h + d * 0.55, -baseWidth * 0.46], '#8ed3ff');
  }

  private makePneumaticPanel() {
    const { length, baseHeight, baseWidth, diameter: d } = this.dimensions;
    const id = 'pneumaticPanel';
    const z = this.layout === 'U' ? baseWidth * 0.4 : -baseWidth * 0.4;
    const x = this.layout === 'L' ? length * 0.28 : 0;
    const panel = this.setPart(new THREE.Group(), id, [x, 0, z]);
    const w = d * 3.2;
    const h = d * 1.05;
    this.addBox(panel, [w, h, d * 0.55], [0, 0, 0], COLORS.dark, id, { metalness: 0.62, roughness: 0.36 });
    this.addBox(panel, [w * 0.9, h * 0.72, d * 0.07], [0, 0, 0], COLORS.steel, id, { metalness: 0.8, roughness: 0.28 });
    const reg = this.addCylinder(panel, d * 0.2, d * 0.2, d * 0.38, [-w * 0.32, h * 0.68, 0], COLORS.steelLight, id, { metalness: 0.65, roughness: 0.29 });
    reg.rotation.x = Math.PI / 2;
    this.addCylinder(panel, d * 0.23, d * 0.23, d * 0.45, [w * 0.3, h * 0.38, 0], COLORS.blue, id, { metalness: 0.3, roughness: 0.4 });
    for (let i = 0; i < 3; i++) {
      this.addCylinder(panel, d * 0.055, d * 0.055, d * 0.32, [-w * 0.3 + i * w * 0.3, -h * 0.16, d * 0.18], COLORS.yellow, id, { radial: 16, metalness: 0.44, roughness: 0.31 });
    }
    this.addLabel('تجهيز الهواء · ضغط/صمامات غير محددة', [x, baseHeight + h + 0.38, z], '#a7dfff');
    const hoseMaterial = new THREE.LineBasicMaterial({ color: COLORS.blue, transparent: true, opacity: 0.8 });
    const routes: [THREE.Vector3, THREE.Vector3][] = [
      [new THREE.Vector3(x, h * 0.55, z), new THREE.Vector3(-length * 0.15, baseHeight + 1, 0)],
      [new THREE.Vector3(x, h * 0.55, z), new THREE.Vector3(0, baseHeight + 1.1, 0)],
      [new THREE.Vector3(x, h * 0.55, z), new THREE.Vector3(this.dimensions.pressX, baseHeight + 1.2, 0)],
    ];
    for (const [a, b] of routes) {
      const points = [a, new THREE.Vector3(a.x, Math.max(baseHeight + 1.2, a.y), a.z * 0.68), new THREE.Vector3(b.x, Math.max(baseHeight + 1.2, a.y), b.z), b];
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(geometry, hoseMaterial);
      line.userData.partId = id;
      this.root.add(line);
      this.partObjects.push(line);
    }
  }

  private makeOutputZone() {
    const { length, diameter: d, railY, baseWidth } = this.dimensions;
    const id = 'outputZone';
    const x = length * 0.47;
    const group = this.setPart(new THREE.Group(), id);
    const material = new THREE.LineDashedMaterial({ color: COLORS.yellow, dashSize: d * 0.2, gapSize: d * 0.15, transparent: true, opacity: 0.8 });
    const points = [
      new THREE.Vector3(x - d * 0.5, railY + d * 0.1, -baseWidth * 0.15),
      new THREE.Vector3(x + d * 1.6, railY + d * 0.1, -baseWidth * 0.15),
      new THREE.Vector3(x + d * 1.6, railY + d * 0.1, baseWidth * 0.15),
      new THREE.Vector3(x - d * 0.5, railY + d * 0.1, baseWidth * 0.15),
      new THREE.Vector3(x - d * 0.5, railY + d * 0.1, -baseWidth * 0.15),
    ];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geometry, material);
    line.computeLineDistances();
    line.userData.partId = id;
    group.add(line);
    this.partObjects.push(line);
    this.addLabel('خروج المنتج · المسار غير محدد', [x + d * 0.45, railY + d * 1.0, 0], '#f4cc76');
  }

  private applyCycle(phase: string, progress: number) {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    const { diameter: d, railY, capHeight: h, washerX, washerZ, pickupZ, pressX, capPusherStroke, pressStroke } = this.dimensions;
    if (this.caps) this.caps.position.x = phase === 'feed' ? capPusherStroke * p : 0;
    if (this.pusherRod) {
      const original = this.pusherRod.userData.homeX as number | undefined;
      if (original === undefined) this.pusherRod.userData.homeX = this.pusherRod.position.x;
      this.pusherRod.position.x = (this.pusherRod.userData.homeX as number) + (phase === 'feed' ? capPusherStroke * p : 0);
    }
    if (this.glueNeedle) {
      const home = this.glueNeedle.userData.homeY as number | undefined;
      if (home === undefined) this.glueNeedle.userData.homeY = this.glueNeedle.position.y;
      this.glueNeedle.position.y = (this.glueNeedle.userData.homeY as number) - (phase === 'glue' ? d * 0.46 * p : 0);
    }
    if (this.glueDrop) this.glueDrop.visible = phase === 'glue' && p > 0.57 && p < 0.94;
    if (this.slideGroup) {
      this.slideGroup.position.z = phase === 'single-washer' ? (pickupZ - washerZ) * p : 0;
    }
    if (this.transferHead) {
      const z = phase === 'transfer' ? THREE.MathUtils.lerp(pickupZ, 0, p) : phase === 'press' || phase === 'release' ? 0 : pickupZ;
      const x = phase === 'transfer' ? THREE.MathUtils.lerp(washerX, pressX, p) : phase === 'press' || phase === 'release' || phase === 'output' ? pressX : washerX;
      const yHome = railY + h + d * 3.15;
      let vertical = 0;
      if (phase === 'transfer') vertical = -d * 0.28 * (1 - p);
      if (phase === 'press') vertical = -pressStroke * p;
      if (phase === 'release') vertical = -pressStroke * (1 - p);
      this.transferHead.position.set(x, yHome + vertical, z);
    }
    if (this.movingWasher) {
      const slideOffset = phase === 'single-washer' ? (pickupZ - washerZ) * p : 0;
      let x = washerX;
      let y = railY + this.dimensions.washerThickness * 0.8;
      let z = washerZ + slideOffset;
      if (phase === 'transfer') {
        x = THREE.MathUtils.lerp(washerX, pressX, p);
        z = THREE.MathUtils.lerp(pickupZ, 0, p);
        y = railY + h + d * 1.7 - d * 0.28 * (1 - p);
      } else if (phase === 'press') {
        x = pressX;
        z = 0;
        y = railY + h + d * 0.34 - d * 0.2 * p;
      } else if (phase === 'release' && p > 0.6) {
        x = pressX;
        z = 0;
        y = railY + h + d * 0.12;
      } else if (phase === 'safety' || phase === 'feed' || phase === 'glue' || phase === 'single-washer') {
        this.movingWasher.visible = false;
      }
      if (phase === 'single-washer' && p > 0.85) this.movingWasher.visible = true;
      if (phase === 'transfer' || phase === 'press' || phase === 'release' || phase === 'output') this.movingWasher.visible = true;
      this.movingWasher.position.set(x, y, z);
    }
  }

  dispose() {
    cancelAnimationFrame(this.frameId);
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener('pointerup', this.handlePick);
    this.controls.dispose();
    this.disposeRoot();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
