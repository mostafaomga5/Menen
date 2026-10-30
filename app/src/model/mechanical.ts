import * as THREE from 'three';

export type PartKind = 'beam' | 'plate' | 'shaft' | 'u-channel' | 'cylinder' | 'tube' | 'slider' | 'cap' | 'washer' | 'gear-blank';
export type MotionRole = 'cap-pusher' | 'cap' | 'glue-gate' | 'washer-slide' | 'press-head' | 'washer' | 'none';
export type JointKind = 'fixed' | 'slider' | 'revolute';
export type Confidence = 'illustrative' | 'measured';
export interface Vec3 { x: number; y: number; z: number }
export interface StudioPart {
  id: string;
  name: string;
  kind: PartKind;
  positionMm: Vec3;
  rotationDeg: Vec3;
  sizeMm: Vec3;
  innerDiameterMm?: number;
  color: string;
  fixed: boolean;
  visible: boolean;
  confidence: Confidence;
  motionRole: MotionRole;
}
export interface AssemblyJoint {
  id: string;
  parentId: string;
  childId: string;
  kind: JointKind;
  axis: Vec3;
  min: number;
  max: number;
  unit: 'mm' | 'deg';
  referenceOffsetMm: Vec3;
  referenceRotationDeg: Vec3;
}
export interface ActuatorSpeeds { pusher: number; glue: number; slide: number; vacuum: number; press: number }
export const DEFAULT_ACTUATOR_SPEEDS: ActuatorSpeeds = { pusher: 1, glue: 1, slide: 1, vacuum: 1, press: 1 };
export interface MechanicalProject {
  schemaVersion: 2;
  name: string;
  template: 'blank' | 'm01';
  unit: 'mm';
  parts: StudioPart[];
  joints: AssemblyJoint[];
  settings: { pusherStrokeMm: number; slideStrokeMm: number; pressStrokeMm: number; cycleSpeed: number; actuatorSpeeds: ActuatorSpeeds };
  createdAt: string;
  updatedAt: string;
}
export interface CatalogItem { kind: PartKind; label: string; description: string; defaultSize: Vec3; color: string; role: MotionRole }

export const WORLD_PER_MM = 0.01;
export const CATALOG: CatalogItem[] = [
  { kind: 'beam', label: 'عارضة / قطاع', description: 'عضو شاسيه مستطيل. الخامة والسُمك واللحام تحتاج تحديدًا.', defaultSize: { x: 600, y: 40, z: 40 }, color: '#71879a', role: 'none' },
  { kind: 'plate', label: 'لوح / قاعدة تثبيت', description: 'لوح مستطيل تمثيلي؛ لا يتضمن تحليل إجهاد أو تفاصيل فتحات.', defaultSize: { x: 260, y: 12, z: 180 }, color: '#54718a', role: 'none' },
  { kind: 'shaft', label: 'عمود / محور', description: 'أسطوانة صلبة بسيطة؛ القطر والمادة والخلوصات مدخلات المستخدم.', defaultSize: { x: 180, y: 20, z: 20 }, color: '#c5d0db', role: 'none' },
  { kind: 'u-channel', label: 'مجرى U', description: 'قاع وجانبان مستطيلان. الخلوص ليس قيمة موصى بها.', defaultSize: { x: 700, y: 90, z: 120 }, color: '#8398ac', role: 'none' },
  { kind: 'cylinder', label: 'أسطوانة نيوماتيكية تمثيلية', description: 'جسم وقضيب بصري؛ ليس اختيار موديل أو حساب تدفق.', defaultSize: { x: 180, y: 58, z: 58 }, color: '#328db5', role: 'none' },
  { kind: 'tube', label: 'مجرى/مخزن مفتوح الوجه', description: 'هيكل ثلاثي الجوانب بفتحة تغذية؛ المصادم لا يمثل أنبوبًا مجوفًا بدقة CAD.', defaultSize: { x: 110, y: 190, z: 100 }, color: '#4a8da9', role: 'none' },
  { kind: 'slider', label: 'كتلة / عربة انزلاق', description: 'كتلة قابلة للربط بمفصل منزلق ومحور وحدود مشوار.', defaultSize: { x: 130, y: 34, z: 72 }, color: '#d4a947', role: 'none' },
  { kind: 'cap', label: 'غطاء تمثيلي', description: 'شكل أسطواني أجوف تقريبًا؛ أدخل قياس العينة بدل أبعاد افتراضية.', defaultSize: { x: 70, y: 38, z: 70 }, color: '#527b9b', role: 'none' },
  { kind: 'washer', label: 'روندلة تمثيلية', description: 'حلقة هندسية؛ خواص الطبقات والمرونة واللصق غير ممثلة.', defaultSize: { x: 50, y: 1.2, z: 50 }, color: '#d7e1e9', role: 'none' },
  { kind: 'gear-blank', label: 'قرص ترس تمثيلي بلا أسنان', description: 'قرص أسطواني فقط؛ لا يحاكي تعشيقًا أو نسبة نقل أو شكل أسنان.', defaultSize: { x: 100, y: 16, z: 100 }, color: '#d3a445', role: 'none' },
];

const now = () => new Date().toISOString();
const part = (id: string, name: string, kind: PartKind, positionMm: Vec3, sizeMm: Vec3, color: string, options: Partial<StudioPart> = {}): StudioPart => ({
  id, name, kind, positionMm, sizeMm, rotationDeg: { x: 0, y: 0, z: 0 }, color, fixed: true, visible: true, confidence: 'illustrative', motionRole: 'none', ...options,
});

export function makeBlankProject(): MechanicalProject {
  return { schemaVersion: 2, name: 'مشروع ميكانيكي جديد', template: 'blank', unit: 'mm', parts: [], joints: [], settings: { pusherStrokeMm: 130, slideStrokeMm: 180, pressStrokeMm: 100, cycleSpeed: 1, actuatorSpeeds: { ...DEFAULT_ACTUATOR_SPEEDS } }, createdAt: now(), updatedAt: now() };
}

export function makeM01Project(): MechanicalProject {
  const parts: StudioPart[] = [
    part('frame-front', 'عارضة القاعدة الأمامية', 'beam', { x: 0, y: 25, z: -250 }, { x: 1400, y: 50, z: 45 }, '#344d63'),
    part('frame-back', 'عارضة القاعدة الخلفية', 'beam', { x: 0, y: 25, z: 250 }, { x: 1400, y: 50, z: 45 }, '#344d63'),
    part('frame-left', 'عارضة القاعدة اليسرى', 'beam', { x: -678, y: 25, z: 0 }, { x: 45, y: 50, z: 455 }, '#405970'),
    part('frame-right', 'عارضة القاعدة اليمنى', 'beam', { x: 678, y: 25, z: 0 }, { x: 45, y: 50, z: 455 }, '#405970'),
    part('post-left', 'قائم الشاسيه الأيسر', 'beam', { x: -550, y: 260, z: -205 }, { x: 42, y: 470, z: 42 }, '#61798d'),
    part('post-right', 'قائم الشاسيه الأيمن', 'beam', { x: 550, y: 260, z: -205 }, { x: 42, y: 470, z: 42 }, '#61798d'),
    part('top-beam', 'عارضة علوية', 'beam', { x: 0, y: 495, z: -205 }, { x: 1125, y: 38, z: 42 }, '#8396a7'),
    part('channel', 'مجرى U للأغطية — تمثيل أولي', 'u-channel', { x: -230, y: 174, z: 0 }, { x: 1020, y: 105, z: 120 }, '#94a6b8'),
    part('cap-pusher', 'بستم/دافع صف الأغطية — وظيفة أولية', 'cylinder', { x: 50, y: 175, z: 0 }, { x: 165, y: 50, z: 50 }, '#2782ad', { fixed: false, motionRole: 'cap-pusher' }),
    part('cap-stop', 'لوح نهاية / مرجع مبدئي', 'plate', { x: -752, y: 138, z: 0 }, { x: 18, y: 72, z: 125 }, '#bd9140'),
    part('glue-frame', 'حامل وحدة الغراء', 'plate', { x: -100, y: 325, z: 0 }, { x: 150, y: 18, z: 110 }, '#3f758c'),
    part('glue-gate', 'لسان جرعة الغراء — حركة افتراضية', 'slider', { x: -100, y: 240, z: 0 }, { x: 92, y: 16, z: 42 }, '#e2b650', { fixed: false, motionRole: 'glue-gate' }),
    part('washer-magazine', 'مخزن الروندلة بفتحة انتقال — تمثيل', 'tube', { x: -260, y: 295, z: 180 }, { x: 110, y: 190, z: 100 }, '#4a8da9'),
    part('washer-slide', 'لسان سحاب الروندلة — حركة افتراضية', 'slider', { x: -260, y: 250, z: 180 }, { x: 74, y: 18, z: 100 }, '#899cad', { fixed: false, motionRole: 'washer-slide' }),
    part('press-frame', 'حامل رأس الكبس', 'plate', { x: -260, y: 385, z: 0 }, { x: 115, y: 16, z: 135 }, '#4f697c'),
    part('press-head', 'رأس الالتقاط/الكبس — الفصل بين الوظيفتين مفتوح', 'cylinder', { x: -260, y: 290, z: 0 }, { x: 62, y: 42, z: 62 }, '#aab9c5', { fixed: false, motionRole: 'press-head' }),
    part('air-manifold', 'مجموعة صمامات هواء — لا توصيل معتمد', 'plate', { x: 420, y: 350, z: -205 }, { x: 230, y: 95, z: 38 }, '#337996'),
  ];
  for (let i = 0; i < 6; i++) parts.push(part(`cap-${i + 1}`, `غطاء متلامس ${i + 1}`, 'cap', { x: -410 + i * 70, y: 152, z: 0 }, { x: 64, y: 36, z: 64 }, '#5c88a8', { fixed: false, motionRole: 'cap' }));
  parts.push(part('washer-1', 'روندلة في جيب اللسان — تمثيل', 'washer', { x: -260, y: 262, z: 180 }, { x: 48, y: 1.2, z: 48 }, '#e1e8ec', { innerDiameterMm: 12, fixed: false, motionRole: 'washer' }));
  return { schemaVersion: 2, name: 'M-01 · ترتيب حركي مفاهيمي', template: 'm01', unit: 'mm', parts, joints: [], settings: { pusherStrokeMm: 130, slideStrokeMm: 180, pressStrokeMm: 100, cycleSpeed: 1, actuatorSpeeds: { ...DEFAULT_ACTUATOR_SPEEDS } }, createdAt: now(), updatedAt: now() };
}

let sequence = 0;
export function createPart(kind: PartKind): StudioPart {
  const item = CATALOG.find((entry) => entry.kind === kind) ?? CATALOG[0];
  sequence += 1;
  return part(`part-${Date.now().toString(36)}-${sequence}`, `${item.label} ${sequence}`, item.kind, { x: 0, y: 220 + sequence * 4, z: 0 }, { ...item.defaultSize }, item.color, { fixed: false, motionRole: item.role, confidence: 'illustrative' });
}

export function cloneProject(project: MechanicalProject): MechanicalProject {
  return JSON.parse(JSON.stringify(project)) as MechanicalProject;
}

const finiteVec = (value: unknown, fallback: Vec3): Vec3 => {
  if (!value || typeof value !== 'object') return { ...fallback };
  const candidate = value as Record<string, unknown>;
  return { x: number(candidate.x, fallback.x), y: number(candidate.y, fallback.y), z: number(candidate.z, fallback.z) };
};
const number = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export function normalizeProject(input: unknown): MechanicalProject | null {
  if (!input || typeof input !== 'object') return null;
  const source = input as Partial<MechanicalProject>;
  if (source.schemaVersion !== 2 || !Array.isArray(source.parts) || source.parts.length > 500) return null;
  const catalogKinds = new Set(CATALOG.map((entry) => entry.kind));
  const parts = source.parts.filter((item): item is StudioPart => Boolean(item && typeof item === 'object' && typeof item.id === 'string' && catalogKinds.has((item as StudioPart).kind))).map((item) => ({
    id: item.id.slice(0, 90), name: String(item.name || item.id).slice(0, 120), kind: item.kind,
    positionMm: finiteVec(item.positionMm, { x: 0, y: 0, z: 0 }), rotationDeg: finiteVec(item.rotationDeg, { x: 0, y: 0, z: 0 }),
    sizeMm: { x: Math.max(1, Math.abs(number(item.sizeMm?.x, 100))), y: Math.max(1, Math.abs(number(item.sizeMm?.y, 30))), z: Math.max(1, Math.abs(number(item.sizeMm?.z, 30))) },
    innerDiameterMm: typeof item.innerDiameterMm === 'number' && Number.isFinite(item.innerDiameterMm) ? Math.max(0, item.innerDiameterMm) : undefined,
    color: /^#[0-9a-f]{6}$/i.test(item.color) ? item.color : '#71879a', fixed: Boolean(item.fixed), visible: item.visible !== false,
    confidence: (item.confidence === 'measured' ? 'measured' : 'illustrative') as Confidence, motionRole: ['cap-pusher','cap','glue-gate','washer-slide','press-head','washer'].includes(item.motionRole) ? item.motionRole : 'none',
  }));
  const ids = new Set(parts.map((partItem) => partItem.id));
  const joints = (Array.isArray(source.joints) ? source.joints : []).filter((joint) => joint && ids.has(joint.parentId) && ids.has(joint.childId) && joint.parentId !== joint.childId && ['fixed','slider','revolute'].includes(joint.kind)).map((joint) => {
    const parent = parts.find((partItem) => partItem.id === joint.parentId);
    const child = parts.find((partItem) => partItem.id === joint.childId);
    return {
      id: String(joint.id).slice(0, 90), parentId: joint.parentId, childId: joint.childId, kind: joint.kind,
      axis: finiteVec(joint.axis, { x: 1, y: 0, z: 0 }), min: number(joint.min, 0), max: number(joint.max, 0), unit: joint.kind === 'revolute' ? 'deg' as const : 'mm' as const,
      referenceOffsetMm: finiteVec(joint.referenceOffsetMm, { x: (child?.positionMm.x ?? 0) - (parent?.positionMm.x ?? 0), y: (child?.positionMm.y ?? 0) - (parent?.positionMm.y ?? 0), z: (child?.positionMm.z ?? 0) - (parent?.positionMm.z ?? 0) }),
      referenceRotationDeg: finiteVec(joint.referenceRotationDeg, { x: (child?.rotationDeg.x ?? 0) - (parent?.rotationDeg.x ?? 0), y: (child?.rotationDeg.y ?? 0) - (parent?.rotationDeg.y ?? 0), z: (child?.rotationDeg.z ?? 0) - (parent?.rotationDeg.z ?? 0) }),
    };
  }).slice(0, 500);
  return {
    schemaVersion: 2, name: String(source.name || 'مشروع ميكانيكي').slice(0, 120), template: source.template === 'm01' ? 'm01' : 'blank', unit: 'mm', parts, joints,
    settings: {
      pusherStrokeMm: Math.max(0, number(source.settings?.pusherStrokeMm, 130)),
      slideStrokeMm: Math.max(0, number(source.settings?.slideStrokeMm, 180)),
      pressStrokeMm: Math.max(0, number(source.settings?.pressStrokeMm, 100)),
      cycleSpeed: Math.min(2, Math.max(0.25, number(source.settings?.cycleSpeed, 1))),
      actuatorSpeeds: {
        pusher: Math.min(2, Math.max(0.25, number(source.settings?.actuatorSpeeds?.pusher, 1))),
        glue: Math.min(2, Math.max(0.25, number(source.settings?.actuatorSpeeds?.glue, 1))),
        slide: Math.min(2, Math.max(0.25, number(source.settings?.actuatorSpeeds?.slide, 1))),
        vacuum: Math.min(2, Math.max(0.25, number(source.settings?.actuatorSpeeds?.vacuum, 1))),
        press: Math.min(2, Math.max(0.25, number(source.settings?.actuatorSpeeds?.press, 1))),
      },
    },
    createdAt: typeof source.createdAt === 'string' ? source.createdAt : now(), updatedAt: now(),
  };
}

export function axisVector(axis: 'x' | 'y' | 'z'): Vec3 {
  return axis === 'x' ? { x: 1, y: 0, z: 0 } : axis === 'y' ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
}
export function millimetersToWorld(value: number): number { return value * WORLD_PER_MM; }
export function toWorld(position: Vec3): THREE.Vector3 { return new THREE.Vector3(position.x * WORLD_PER_MM, position.y * WORLD_PER_MM, position.z * WORLD_PER_MM); }
export function fromWorld(position: THREE.Vector3): Vec3 { return { x: position.x / WORLD_PER_MM, y: position.y / WORLD_PER_MM, z: position.z / WORLD_PER_MM }; }
