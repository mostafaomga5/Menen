import type { MechanicalProject, MotionRole, StudioPart, Vec3, ActuatorSpeeds } from '../model/mechanical';

export interface CycleStep {
  id: string;
  title: string;
  explanation: string;
  actuator: string;
  sensor: string;
  output: string;
  caution: string;
}
export interface MotionTarget { partId: string; positionMm: Vec3 }

export const M01_STEPS: CycleStep[] = [
  { id: 'feed', title: 'دفع صف الأغطية', explanation: 'يتقدم بستم واحد ويدفع صف الأغطية المتلامسة على مجرى U. الحركة التوضيحية لا تثبت منع الانحشار.', actuator: 'O1 · دافع الغطاء', sensor: 'S1 · نهاية شوط أمامي (افتراضي)', output: 'O1_EXTEND', caution: 'افتراض: كل الأغطية متلامسة والمسار مضبوط؛ لا سير ناقل ولا قرص فهرسة.' },
  { id: 'return', title: 'رجوع الدافع وتجهيز غطاء تالٍ', explanation: 'يرجع الدافع؛ طريقة إسقاط/حجز الغطاء التالي في المرجع تحتاج قياسًا وتصميمًا، لذلك لا نضيف آلية تغذية جديدة.', actuator: 'O1 · دافع الغطاء', sensor: 'S2 · نهاية شوط رجوع (افتراضي)', output: 'O1_RETRACT', caution: 'طريقة منع سقوط غطاءين من المخزن غير محسومة.' },
  { id: 'glue-slide', title: 'نبضة لسان الغراء وانتقال لسان الروندلة', explanation: 'يفتح اللسان الداخلي لحظيًا لتمثيل جرعة واحدة، ويتحرك لسان الروندلة باتجاه موضع الالتقاط.', actuator: 'O2 · لسان الجرعة + O3 · اللسان السحاب', sensor: 'S3 · وصول اللسان (افتراضي)', output: 'O2_PULSE + O3_EXTEND', caution: 'كمية الغراء ونوعه وزمن الانتظار غير ممثلة ولا معتمدة.' },
  { id: 'pickup', title: 'التقاط الروندلة والرأس ثابت', explanation: 'يبقى رأس الفاكيوم في موضعه ويلتقط الروندلة من جيب اللسان؛ لا يحاكي الرسم تدفق الفاكيوم الحقيقي.', actuator: 'O5 · فاكيوم افتراضي', sensor: 'S4 · تأكيد فاكيوم (افتراضي)', output: 'VACUUM_ON', caution: 'كوب الشفط والتدفق ووسيلة تأكيد الالتقاط تحتاج اختيارًا واختبارًا.' },
  { id: 'slide-return', title: 'رجوع اللسان إلى المخزن', explanation: 'يرجع اللسان السحاب، وتظل الروندلة معلقة بالرأس في التمثيل إذا كانت إشارة الفاكيوم مفعلة.', actuator: 'O3 · اللسان السحاب', sensor: 'S5 · رجوع اللسان (افتراضي)', output: 'O3_RETRACT', caution: 'الجيب ومجرى الانزلاق والخلوص أبعادها غير معتمدة.' },
  { id: 'press', title: 'هبوط رأس الكبس ثم رجوعه', explanation: 'يهبط الرأس رأسيًا ثم يرجع؛ لا يخترع النموذج مخرجًا آليًا للمنتج.', actuator: 'O4 · رأس الكبس', sensor: 'S6 · تأكيد أعلى/أسفل (افتراضي)', output: 'O4_EXTEND → O4_RETRACT', caution: 'هل رأس الكبس هو نفسه رأس الفاكيوم؟ القرار وقوة الكبس مفتوحان.' },
];

const byRole = (parts: StudioPart[], role: MotionRole) => parts.filter((part) => part.motionRole === role);
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const smooth = (value: number) => { const t = clamp01(value); return t * t * (3 - 2 * t); };
const moved = (part: StudioPart, positionMm: Vec3): MotionTarget => ({ partId: part.id, positionMm });
const lerpVec = (a: Vec3, b: Vec3, t: number): Vec3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
const washerHoldPose = (head: StudioPart, washer: StudioPart): Vec3 => ({ x: head.positionMm.x, y: head.positionMm.y - head.sizeMm.y / 2 - washer.sizeMm.y / 2, z: head.positionMm.z });

function targetsForSingleStep(state: MechanicalProject, stepIndex: number, progress: number): MotionTarget[] {
  const t = clamp01(progress);
  const rates: ActuatorSpeeds = state.settings.actuatorSpeeds;
  const roles = (role: MotionRole) => byRole(state.parts, role);
  const pusher = roles('cap-pusher')[0];
  const caps = roles('cap');
  const gate = roles('glue-gate')[0];
  const slide = roles('washer-slide')[0];
  const head = roles('press-head')[0];
  const washers = roles('washer');
  const washer = washers[0];
  const result: MotionTarget[] = [];
  const stroke = state.settings.pusherStrokeMm;
  const slideStroke = state.settings.slideStrokeMm;
  const pressStroke = state.settings.pressStrokeMm;

  if (stepIndex === 0) {
    const movement = clamp01(t * rates.pusher) * stroke;
    if (pusher) result.push(moved(pusher, { ...pusher.positionMm, x: pusher.positionMm.x - movement }));
    caps.forEach((cap) => result.push(moved(cap, { ...cap.positionMm, x: cap.positionMm.x - movement })));
  } else if (stepIndex === 1) {
    if (pusher) result.push(moved(pusher, { ...pusher.positionMm, x: pusher.positionMm.x + clamp01(t * rates.pusher) * stroke }));
    // لا تُستنتج آلية تغذية أو حجز إضافية من الرسم المرجعي.
  } else if (stepIndex === 2) {
    const glueT = clamp01(t * rates.glue);
    const slideT = clamp01(t * rates.slide);
    if (gate) result.push(moved(gate, { ...gate.positionMm, x: gate.positionMm.x + Math.sin(Math.PI * glueT) * 14 }));
    if (slide) result.push(moved(slide, { ...slide.positionMm, z: slide.positionMm.z - slideStroke * slideT }));
    if (slide && washer) result.push(moved(washer, { ...washer.positionMm, x: slide.positionMm.x, z: slide.positionMm.z - slideStroke * slideT }));
  } else if (stepIndex === 3) {
    if (slide) result.push(moved(slide, { ...slide.positionMm }));
    if (head && slide && washer) {
      const pickupT = smooth((clamp01(t * rates.vacuum) - 0.45) / 0.55);
      const pocket = { x: slide.positionMm.x, y: washer.positionMm.y, z: slide.positionMm.z };
      const held = washerHoldPose(head, washer);
      result.push(moved(washer, lerpVec(pocket, held, pickupT)));
    }
  } else if (stepIndex === 4) {
    const returnT = clamp01(t * rates.slide);
    if (slide) result.push(moved(slide, { ...slide.positionMm, z: slide.positionMm.z + slideStroke * returnT }));
    if (washer && head) result.push(moved(washer, washerHoldPose(head, washer)));
  } else if (stepIndex === 5) {
    const pressT = clamp01(t * rates.press);
    const strokePhase = pressT < 0.58 ? pressT / 0.58 : (1 - pressT) / 0.42;
    if (head) result.push(moved(head, { ...head.positionMm, y: head.positionMm.y - Math.max(0, strokePhase) * pressStroke }));
    if (washer && head) {
      if (pressT < 0.58) {
        const held = washerHoldPose(head, washer);
        result.push(moved(washer, { ...held, y: held.y - (pressT / 0.58) * pressStroke }));
      } else {
        const pressedCap = caps.find((cap) => Math.abs(cap.positionMm.x - head.positionMm.x) < 100) ?? caps[0];
        if (pressedCap) result.push(moved(washer, { x: pressedCap.positionMm.x, y: pressedCap.positionMm.y + pressedCap.sizeMm.y / 2 + 1, z: pressedCap.positionMm.z }));
      }
    }
  }
  return result;
}

/** Rebuild the start pose for each stage from the prior completed stages. */
export function targetsForStep(base: MechanicalProject, stepIndex: number, progress: number): MotionTarget[] {
  const stage = JSON.parse(JSON.stringify(base)) as MechanicalProject;
  for (let completed = 0; completed < stepIndex; completed += 1) {
    for (const target of targetsForSingleStep(stage, completed, 1)) {
      const part = stage.parts.find((item) => item.id === target.partId);
      if (part) part.positionMm = { ...target.positionMm };
    }
  }
  return targetsForSingleStep(stage, stepIndex, progress);
}

/** A step cannot pass its end sensor while its configured actuator is too slow to finish its modeled stroke. */
export function stepMotionComplete(base: MechanicalProject, stepIndex: number): boolean {
  const s = base.settings.actuatorSpeeds;
  if (stepIndex === 0 || stepIndex === 1) return s.pusher >= 0.999;
  if (stepIndex === 2) return s.glue >= 0.999 && s.slide >= 0.999;
  if (stepIndex === 3) return s.vacuum >= 0.999;
  if (stepIndex === 4) return s.slide >= 0.999;
  if (stepIndex === 5) return s.press >= 0.999;
  return false;
}

export function roleName(role: MotionRole): string {
  return ({ 'cap-pusher': 'دافع صف الأغطية', cap: 'غطاء متلامس', 'glue-gate': 'لسان جرعة الغراء', 'washer-slide': 'اللسان السحاب', 'press-head': 'رأس الفاكيوم/الكبس', washer: 'روندلة', none: 'قطعة غير متحركة تلقائيًا' } as Record<MotionRole, string>)[role];
}
