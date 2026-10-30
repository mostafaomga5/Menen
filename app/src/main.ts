import * as THREE from 'three';
import { CATALOG, cloneProject, createPart, makeBlankProject, makeM01Project, normalizeProject, type ActuatorSpeeds, type AssemblyJoint, type MechanicalProject, type StudioPart, type Vec3 } from './model/mechanical';
import { MechanicalWorkbench } from './scene/MechanicalWorkbench';
import { M01_STEPS, stepMotionComplete, targetsForStep } from './simulation/m01-motion';
import { controlDiagram, pneumaticDiagram } from './ui/diagrams';

const PROJECT_KEY = 'mechanical-design-studio-v2';
const LEGACY_KEY = 'm01-design-studio-v1';
const appRoot = document.querySelector<HTMLElement>('#app');
if (!appRoot) throw new Error('Application root is missing.');
const app: HTMLElement = appRoot;
const $ = <T extends HTMLElement = HTMLElement>(selector: string, parent: ParentNode = document) => {
  const node = parent.querySelector<T>(selector);
  if (!node) throw new Error(`Required element not found: ${selector}`);
  return node;
};
const $$ = <T extends HTMLElement = HTMLElement>(selector: string, parent: ParentNode = document) => Array.from(parent.querySelectorAll<T>(selector));
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
const finite = (value: string, fallback: number) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; };

function migrateV1(): MechanicalProject | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const old = JSON.parse(raw) as { measurements?: Record<string, number>; layout?: string };
    const measurements = old.measurements ?? {};
    const migrated = makeM01Project();
    const cap = migrated.parts.find((part) => part.id === 'cap-1');
    const washer = migrated.parts.find((part) => part.id === 'washer-1');
    const channel = migrated.parts.find((part) => part.id === 'channel');
    const setMeasured = (part: StudioPart | undefined, x: number | undefined, y: number | undefined, z: number | undefined, inner?: number) => {
      if (!part) return;
      if (x && x > 0) part.sizeMm.x = x;
      if (y && y > 0) part.sizeMm.y = y;
      if (z && z > 0) part.sizeMm.z = z;
      if (inner !== undefined) part.innerDiameterMm = inner;
      if (x || y || z) part.confidence = 'measured';
    };
    setMeasured(cap, measurements.capOuterDiameter, measurements.capHeight, measurements.capOuterDiameter, measurements.capInnerDiameter);
    setMeasured(washer, measurements.washerDiameter, measurements.washerThickness, measurements.washerDiameter, measurements.washerInnerDiameter);
    setMeasured(channel, measurements.channelLength, measurements.channelWallHeight, measurements.channelInnerWidth);
    migrated.settings.pusherStrokeMm = measurements.capPusherStroke || migrated.settings.pusherStrokeMm;
    migrated.settings.slideStrokeMm = measurements.washerSlideStroke || migrated.settings.slideStrokeMm;
    migrated.settings.pressStrokeMm = measurements.pressStroke || migrated.settings.pressStrokeMm;
    if (measurements.channelClearancePerSide && !measurements.channelInnerWidth && measurements.capOuterDiameter) {
      if (channel) channel.sizeMm.z = measurements.capOuterDiameter + 2 * measurements.channelClearancePerSide;
    }
    migrated.name = 'M-01 · مُرحّل من إعدادات الإصدار السابق';
    return migrated;
  } catch { return null; }
}

function readProject(): MechanicalProject {
  try {
    const saved = localStorage.getItem(PROJECT_KEY);
    if (saved) {
      const normalized = normalizeProject(JSON.parse(saved));
      if (normalized) return normalized;
    }
  } catch { /* Ignore corrupt local settings; the starter remains available. */ }
  return migrateV1() ?? makeM01Project();
}

let project = readProject();
let workbench: MechanicalWorkbench | null = null;
let selectedPartId: string | null = null;
let currentPanel = 'design-panel';
let toastTimer = 0;
let saveTimer = 0;
let cycleTimer = 0;
let cycleMode: 'auto' | 'manual' = 'auto';
let activeStep = 0;
let stepProgress = 0;
let speed = project.settings.cycleSpeed;
let playing = false;
let motionApplying = false;
let cycleHasRun = false;
let cycleBase: MechanicalProject | null = null;
let history: MechanicalProject[] = [];
let historyIndex = -1;
let axisSelected: 'x' | 'y' | 'z' = 'x';
const SENSOR_IDS = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'];
const OUTPUTS = [
  { id: 'O1', label: 'دافع الغطاء', sensor: 'صمام وظيفة مبدئية' },
  { id: 'O2', label: 'لسان الغراء', sensor: 'جرعة افتراضية' },
  { id: 'O3', label: 'لسان الروندلة', sensor: 'امتداد/رجوع' },
  { id: 'O4', label: 'رأس الكبس', sensor: 'نزول/رجوع' },
  { id: 'O5', label: 'فاكيوم', sensor: 'شفط افتراضي' },
];
const SENSORS = [
  { id: 'S1', label: 'نهاية دفع الصف' }, { id: 'S2', label: 'رجوع الدافع' },
  { id: 'S3', label: 'وصول اللسان' }, { id: 'S4', label: 'تأكيد الفاكيوم' },
  { id: 'S5', label: 'رجوع اللسان' }, { id: 'S6', label: 'أعلى/أسفل الرأس' },
];
let outputs: Record<string, boolean> = Object.fromEntries(OUTPUTS.map((item) => [item.id, false]));
let sensors: Record<string, boolean> = Object.fromEntries(SENSORS.map((item) => [item.id, true]));

function showToast(message: string) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 3000);
}

function currentDesignSnapshot(): MechanicalProject {
  return cycleBase ? cloneProject(cycleBase) : cloneProject(project);
}

function saveLocal(showMessage = true) {
  try {
    localStorage.setItem(PROJECT_KEY, JSON.stringify(currentDesignSnapshot()));
    if (showMessage) showToast('حُفظ المشروع محليًا على هذا الجهاز فقط.');
  } catch { showToast('تعذر الحفظ المحلي؛ تحقق من مساحة المتصفح أو إعداداته.'); }
}

function scheduleSave() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => saveLocal(false), 350);
}

function pushHistory() {
  if (motionApplying) return;
  if (historyIndex >= 0 && JSON.stringify(history[historyIndex]) === JSON.stringify(project)) return;
  history = history.slice(0, historyIndex + 1);
  history.push(cloneProject(project));
  if (history.length > 50) history.shift();
  historyIndex = history.length - 1;
  updateHistoryButtons();
}

function updateHistoryButtons() {
  $('#undo').toggleAttribute('disabled', historyIndex <= 0);
  $('#redo').toggleAttribute('disabled', historyIndex < 0 || historyIndex >= history.length - 1);
}

function applyProject(next: MechanicalProject, record = true, message?: string) {
  pauseCycle();
  project = cloneProject(next);
  speed = project.settings.cycleSpeed;
  workbench?.setProject(project);
  if (workbench) project = workbench.currentProject;
  cycleBase = null;
  cycleHasRun = false;
  renderAll();
  if (record) pushHistory();
  scheduleSave();
  if (message) showToast(message);
}

function restoreCycleForEdit() {
  if (!cycleBase) return;
  pauseCycle();
  project = cloneProject(cycleBase);
  cycleHasRun = false;
  activeStep = 0; stepProgress = 0;
  outputs = Object.fromEntries(OUTPUTS.map((item) => [item.id, false]));
  workbench?.setProject(project);
  if (workbench) project = workbench.currentProject;
  cycleBase = null;
  renderAll();
  showToast('أُعيد المشهد إلى وضع التصميم قبل بدء التعديل.');
}

function renderCatalog() {
  $('#catalog-kind').innerHTML = CATALOG.map((item) => `<option value="${item.kind}">${escapeHtml(item.label)}</option>`).join('');
}

function renderTree() {
  const tree = $('#part-tree');
  $('#part-count').textContent = `${project.parts.length} قطعة · ${project.joints.length} علاقة`;
  tree.innerHTML = project.parts.length ? project.parts.map((part) => `
    <div class="tree-item ${part.id === selectedPartId ? 'selected' : ''}" role="treeitem" aria-selected="${part.id === selectedPartId}" data-tree-row="${escapeHtml(part.id)}">
      <span class="tree-icon" style="background:${escapeHtml(part.color)}"></span>
      <button class="tree-select" type="button" data-tree-select="${escapeHtml(part.id)}">${escapeHtml(part.name)}</button>
      <small>${part.confidence === 'measured' ? 'مقاس' : 'تمثيل'}</small>
      <button class="tree-action" type="button" data-tree-visibility="${escapeHtml(part.id)}" aria-label="${part.visible ? 'إخفاء' : 'إظهار'} ${escapeHtml(part.name)}">${part.visible ? '◉' : '○'}</button>
    </div>`).join('') : '<div class="tree-empty">لا توجد قطع بعد. أضف قطعة من المكتبة.</div>';
  const parent = $('#joint-parent');
  const options = project.parts.filter((part) => part.id !== selectedPartId);
  parent.innerHTML = options.length ? options.map((part) => `<option value="${escapeHtml(part.id)}">${escapeHtml(part.name)}</option>`).join('') : '<option value="">أضف قطعة أخرى أولًا</option>';
  $('#create-joint').toggleAttribute('disabled', !selectedPartId || !options.length);
  $('#joint-list').innerHTML = project.joints.length ? project.joints.map((joint) => {
    const parentName = project.parts.find((part) => part.id === joint.parentId)?.name ?? joint.parentId;
    const childName = project.parts.find((part) => part.id === joint.childId)?.name ?? joint.childId;
    const label = joint.kind === 'fixed' ? 'ثابت' : joint.kind === 'slider' ? `منزلق ${joint.min}–${joint.max} مم` : `دوراني ${joint.min}–${joint.max}°`;
    return `<div class="joint-list-item"><span><strong>${escapeHtml(childName)}</strong><small>${escapeHtml(label)} ← ${escapeHtml(parentName)}</small></span><button class="small-button danger" type="button" data-joint-delete="${escapeHtml(joint.id)}">فك</button></div>`;
  }).join('') : '<p class="micro-note">لا توجد علاقات بعد.</p>';
}

function renderInspector() {
  const part = selectedPartId ? project.parts.find((item) => item.id === selectedPartId) : undefined;
  const fieldSelectors = ['[data-pos-axis]', '[data-rot-axis]', '[data-size-axis]', '[data-size-nudge]', '#inner-diameter', '#axis-value', '#apply-axis-value', '#apply-dimensions', '#fixed-lock', '#measured-toggle', '#duplicate-part', '#toggle-visibility', '#delete-part'];
  fieldSelectors.forEach((selector) => $$(selector).forEach((element) => { (element as HTMLInputElement | HTMLButtonElement).disabled = !part; }));
  if (!part) {
    $('#inspector-name').textContent = 'لا يوجد جزء محدد';
    $('#inspector-description').textContent = 'المس قطعة في المجسم أو اخترها من شجرة التجميع.';
    $('#confidence-tag').textContent = '—';
    $('#confidence-tag').className = 'confidence-tag';
    $('#selected-summary').textContent = 'اختر جزءًا من المجسم لعرض خصائصه';
    ($('#fixed-lock') as HTMLInputElement).checked = false;
    ($('#measured-toggle') as HTMLInputElement).checked = false;
    $('#inspector-warning').hidden = true;
    return;
  }
  const catalog = CATALOG.find((item) => item.kind === part.kind);
  $('#inspector-name').textContent = part.name;
  $('#inspector-description').textContent = catalog?.description ?? 'قطعة تمثيلية قابلة للتحرير.';
  $('#selected-summary').textContent = `${part.name} · ${part.kind} · ${part.confidence === 'measured' ? 'مدخل بقياس عينة' : 'قيمة تمثيلية'}`;
  $('#confidence-tag').textContent = part.confidence === 'measured' ? 'قياس معلّم من المستخدم' : 'تمثيلي · غير معتمد';
  $('#confidence-tag').className = `confidence-tag ${part.confidence === 'measured' ? 'measured' : ''}`;
  ($('#fixed-lock') as HTMLInputElement).checked = part.fixed;
  ($('#measured-toggle') as HTMLInputElement).checked = part.confidence === 'measured';
  $$<HTMLInputElement>('[data-pos-axis]').forEach((input) => { input.value = part.positionMm[input.dataset.posAxis as keyof Vec3].toFixed(1); });
  $$<HTMLInputElement>('[data-rot-axis]').forEach((input) => { input.value = part.rotationDeg[input.dataset.rotAxis as keyof Vec3].toFixed(1); });
  $$<HTMLInputElement>('[data-size-axis]').forEach((input) => { input.value = part.sizeMm[input.dataset.sizeAxis as keyof Vec3].toFixed(1); });
  ($('#inner-diameter') as HTMLInputElement).value = part.innerDiameterMm === undefined ? '' : String(part.innerDiameterMm);
  ($('#duplicate-part') as HTMLButtonElement).disabled = false;
  ($('#toggle-visibility') as HTMLButtonElement).disabled = false;
  $('#toggle-visibility').textContent = part.visible ? 'إخفاء' : 'إظهار';
  ($('#delete-part') as HTMLButtonElement).disabled = false;
  const warning = $('#inspector-warning');
  const warnings: string[] = [];
  if (part.kind === 'gear-blank') warnings.push('هذا قرص بلا أسنان؛ لا يحاكي تعشيق التروس.');
  if (part.confidence !== 'measured') warnings.push('الأبعاد الحالية قيم بداية تمثيلية. علّمها كمقاسة فقط إذا قست القطعة فعليًا.');
  if (project.joints.some((joint) => joint.parentId === part.id || joint.childId === part.id)) warnings.push('هذه القطعة مرتبطة بمفصل؛ تغيير موضعها قد يؤثر على علاقة التجميع.');
  warning.textContent = warnings.join(' ');
  warning.hidden = !warnings.length;
}

function renderPanelState() {
  $$('.workspace-panel').forEach((panel) => {
    const active = panel.id === currentPanel;
    panel.hidden = !active;
    panel.classList.toggle('active', active);
  });
  $$('.panel-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.panel === currentPanel));
  requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
}

function renderAll() {
  ($('#project-name') as HTMLInputElement).value = project.name;
  renderTree();
  renderInspector();
  renderPanelState();
  renderActuatorSpeeds();
  renderStepCards();
  renderIo();
  renderCycle();
  $('#canvas-empty').hidden = project.parts.length > 0;
}

function renderStepCards() {
  $('#cycle-step-list').innerHTML = M01_STEPS.map((step, index) => `<button type="button" class="cycle-step-button ${index === activeStep ? 'active' : ''}" data-cycle-index="${index}"><span>STEP ${String(index + 1).padStart(2, '0')}</span>${escapeHtml(step.title)}</button>`).join('');
}

function renderCycle() {
  const step = M01_STEPS[activeStep];
  if (!step) return;
  $('#cycle-step-title').textContent = step.title;
  $('#cycle-step-explanation').textContent = step.explanation;
  $('#step-actuator').textContent = step.actuator;
  $('#step-sensor').textContent = step.sensor;
  $('#step-caution').textContent = step.caution;
  $('#cycle-progress').style.width = `${Math.round(stepProgress * 100)}%`;
  $('#cycle-state').textContent = playing ? `جارٍ · ${cycleMode === 'auto' ? 'تلقائي' : 'يدوي'}` : cycleHasRun ? 'تمثيل الحركة معروض' : 'متوقف — جاهز';
  $('#cycle-play').textContent = playing ? 'إيقاف مؤقت' : cycleHasRun ? 'أعد الضبط أولًا' : 'تشغيل';
  $('#cycle-play').toggleAttribute('disabled', cycleMode !== 'auto' || cycleHasRun);
  $('#cycle-step').toggleAttribute('disabled', playing || cycleMode !== 'auto' || cycleHasRun);
  $('#cycle-step-list').querySelectorAll<HTMLButtonElement>('[data-cycle-index]').forEach((button) => {
    const index = Number(button.dataset.cycleIndex);
    button.classList.toggle('active', index === activeStep);
    button.classList.toggle('done', index < activeStep);
    button.disabled = playing || cycleHasRun || index !== activeStep;
  });
  $('#controller-mode').textContent = cycleMode === 'auto' ? 'تلقائي' : 'يدوي';
}

function renderIo() {
  $('#output-grid').innerHTML = OUTPUTS.map((output) => `<div class="io-card"><span><strong>${output.id}</strong><small>${escapeHtml(output.label)}</small></span><button class="io-toggle ${outputs[output.id] ? 'on' : ''}" type="button" data-output="${output.id}" aria-pressed="${outputs[output.id]}" ${cycleMode === 'auto' ? 'disabled' : ''}>${outputs[output.id] ? 'ON' : 'OFF'}</button></div>`).join('');
  $('#sensor-grid').innerHTML = SENSORS.map((sensor) => `<div class="io-card"><span><strong>${sensor.id}</strong><small>${escapeHtml(sensor.label)}</small></span><button class="io-toggle ${sensors[sensor.id] ? 'on' : 'fault'}" type="button" data-sensor="${sensor.id}" aria-pressed="${sensors[sensor.id]}">${sensors[sensor.id] ? '1' : '0'}</button></div>`).join('');
  $$('.controller-mode-buttons button').forEach((button) => button.classList.toggle('active', button.getAttribute('data-control-mode') === cycleMode));
}

function renderActuatorSpeeds() {
  ($('#cycle-speed') as HTMLInputElement).value = String(project.settings.cycleSpeed);
  $('#speed-readout').textContent = `${project.settings.cycleSpeed.toFixed(2)}×`;
  $$<HTMLInputElement>('[data-actuator-speed]').forEach((input) => {
    const key = input.dataset.actuatorSpeed as keyof ActuatorSpeeds;
    if (!(key in project.settings.actuatorSpeeds)) return;
    const value = project.settings.actuatorSpeeds[key];
    input.value = String(value);
    const readout = document.querySelector<HTMLOutputElement>(`[data-speed-readout="${key}"]`);
    if (readout) readout.value = `${value.toFixed(2)}×`;
  });
}

function renderPhysics(status: string, ready: boolean) {
  $('#physics-status').textContent = status;
  $('#physics-led').className = `status-led ${ready ? '' : 'amber'}`;
  if (!ready) $('#controller-alert').textContent = status;
  else $('#controller-alert').textContent = 'كل إشارة في هذا القسم افتراضية؛ لا يوجد اتصال كهربائي.';
}

function reportCollision(moved: StudioPart, blocker: { partId: string; partName: string; timeOfImpact?: number }) {
  const label = playing ? M01_STEPS[activeStep]?.title : 'التعديل الحالي';
  const reason = 'reason' in blocker ? blocker.reason : undefined;
  const message = reason === 'joint-limit'
    ? `توقف عند حد التجميع: «${moved.name}» يتجاوز علاقة الحركة مع «${blocker.partName}» أثناء ${label}. راجع محور المفصل وحدوده.`
    : `توقف عند تصادم: «${moved.name}» يصطدم بـ «${blocker.partName}» أثناء ${label}. راجع المصادم أو المحور/الأبعاد.`;
  $('#collision-status').textContent = message;
  $('#collision-status').classList.add('blocked');
  $('#controller-alert').textContent = message;
  if (playing) pauseCycle();
  showToast(reason === 'joint-limit' ? `تجاوز مسموح المفصل بين ${moved.name} و${blocker.partName}.` : `تصادم بين ${moved.name} و${blocker.partName}؛ لم تمر القطعة عبر العائق.`);
}

function setCollisionClear() {
  $('#collision-status').textContent = 'لا توجد عوائق مرصودة في الخطوة الحالية';
  $('#collision-status').classList.remove('blocked');
}

function initWorkbench() {
  const mount = $('#viewport-mount');
  try {
    workbench = new MechanicalWorkbench(mount, project, {
      onSelect: (part) => {
        selectedPartId = part?.id ?? null;
        renderTree();
        renderInspector();
      },
      onChanged: (part, final) => {
        if (!workbench) return;
        project = workbench.currentProject;
        renderInspector();
        if (final && !motionApplying) {
          restoreCycleForEdit();
          pushHistory();
          renderTree();
          scheduleSave();
        }
      },
      onCollision: reportCollision,
      onPhysics: renderPhysics,
    });
    project = workbench.currentProject;
    void workbench.ready;
  } catch (error) {
    console.error(error);
    renderPhysics('تعذر إنشاء مشهد WebGL؛ جرّب متصفحًا يدعم WebGL 2.', false);
  }
}

function applySelectedPoseFromInputs(event: Event) {
  if (!workbench || !selectedPartId) return;
  const input = event.currentTarget as HTMLInputElement;
  const positionAxis = input.dataset.posAxis as keyof Vec3 | undefined;
  const rotationAxis = input.dataset.rotAxis as keyof Vec3 | undefined;
  const value = finite(input.value, 0);
  restoreCycleForEdit();
  const part = project.parts.find((item) => item.id === selectedPartId);
  if (!part) return;
  const positionMm: Vec3 = { ...part.positionMm };
  const rotationDeg: Vec3 = { ...part.rotationDeg };
  if (positionAxis) positionMm[positionAxis] = value;
  if (rotationAxis) rotationDeg[rotationAxis] = value;
  if (workbench.applyPose(part.id, { positionMm, rotationDeg })) {
    project = workbench.currentProject;
    renderInspector(); renderTree(); pushHistory(); scheduleSave(); setCollisionClear();
  }
}

function applySelectedSize(sizeOverride?: Vec3, markMeasured = false) {
  if (!workbench || !selectedPartId) return;
  const current = project.parts.find((item) => item.id === selectedPartId);
  if (!current) return;
  const sizeMm = sizeOverride ?? { ...current.sizeMm };
  if (!sizeOverride) $$<HTMLInputElement>('[data-size-axis]').forEach((input) => { sizeMm[input.dataset.sizeAxis as keyof Vec3] = Math.max(1, finite(input.value, current.sizeMm[input.dataset.sizeAxis as keyof Vec3])); });
  const innerText = ($('#inner-diameter') as HTMLInputElement).value.trim();
  const measured = markMeasured || ($('#measured-toggle') as HTMLInputElement).checked;
  const inner = innerText ? Math.max(0, finite(innerText, 0)) : undefined;
  restoreCycleForEdit();
  const part = project.parts.find((item) => item.id === selectedPartId);
  if (!part) return;
  if (inner !== undefined && inner > Math.min(sizeMm.x, sizeMm.z)) {
    showToast('القطر الداخلي لا يمكن أن يتجاوز القطر الخارجي للجزء.');
    renderInspector();
    return;
  }
  if (measured) part.confidence = 'measured';
  const collision = workbench.applySize(part.id, sizeMm, inner);
  project = workbench.currentProject;
  renderInspector(); renderTree(); pushHistory(); scheduleSave();
  if (!collision) { setCollisionClear(); showToast(part.confidence === 'measured' ? 'حُدثت الأبعاد وعُلّمت كقياس مأخوذ من عينة.' : 'حُدثت أبعاد المجسم؛ تظل تمثيلية حتى تؤكدها بالقياس.'); }
}

function nudgePosition(axis: keyof Vec3, amount: number) {
  if (!workbench || !selectedPartId) return;
  const typed = ($('#axis-value') as HTMLInputElement).value.trim();
  const delta = typed ? Math.abs(finite(typed, Math.abs(amount))) * Math.sign(amount) : amount;
  restoreCycleForEdit();
  const part = project.parts.find((item) => item.id === selectedPartId);
  if (!part) return;
  const positionMm = { ...part.positionMm, [axis]: part.positionMm[axis] + delta };
  if (workbench.applyPose(part.id, { positionMm, rotationDeg: { ...part.rotationDeg } })) {
    project = workbench.currentProject; renderInspector(); renderTree(); pushHistory(); scheduleSave(); setCollisionClear();
  }
}

function nudgeSize(axis: keyof Vec3, sign: 1 | -1) {
  if (!workbench || !selectedPartId) return;
  restoreCycleForEdit();
  const part = project.parts.find((item) => item.id === selectedPartId);
  if (!part) return;
  applySelectedSize({ ...part.sizeMm, [axis]: Math.max(1, part.sizeMm[axis] + sign * 10) });
}

function addSelectedPart() {
  restoreCycleForEdit();
  const kind = ($('#catalog-kind') as HTMLSelectElement).value as StudioPart['kind'];
  project.parts.push(createPart(kind));
  project.updatedAt = new Date().toISOString();
  workbench?.setProject(project);
  if (workbench) project = workbench.currentProject;
  const newPart = project.parts[project.parts.length - 1];
  selectedPartId = newPart?.id ?? null;
  if (selectedPartId) workbench?.selectPart(selectedPartId);
  renderAll(); pushHistory(); scheduleSave();
  showToast('أُضيفت قطعة تمثيلية؛ حدد أبعادها وموقعها من لوحة الخصائص.');
}

function duplicateSelectedPart() {
  restoreCycleForEdit();
  const source = selectedPartId ? project.parts.find((part) => part.id === selectedPartId) : undefined;
  if (!source) return;
  const copy = structuredClone(source) as StudioPart;
  copy.id = `copy-${Date.now().toString(36)}`;
  copy.name = `${source.name} · نسخة`;
  copy.positionMm = { ...source.positionMm, x: source.positionMm.x + 90 };
  copy.motionRole = 'none';
  copy.fixed = false;
  copy.confidence = 'illustrative';
  project.parts.push(copy);
  workbench?.setProject(project);
  if (workbench) project = workbench.currentProject;
  workbench?.selectPart(copy.id); selectedPartId = copy.id;
  renderAll(); pushHistory(); scheduleSave();
}

function deleteSelectedPart() {
  restoreCycleForEdit();
  if (!selectedPartId) return;
  const removedJoints = project.joints.filter((joint) => joint.parentId === selectedPartId || joint.childId === selectedPartId).length;
  project.parts = project.parts.filter((part) => part.id !== selectedPartId);
  project.joints = project.joints.filter((joint) => joint.parentId !== selectedPartId && joint.childId !== selectedPartId);
  selectedPartId = null;
  workbench?.setProject(project);
  if (workbench) project = workbench.currentProject;
  renderAll(); pushHistory(); scheduleSave();
  showToast(removedJoints ? `حُذفت القطعة و${removedJoints} علاقة مرتبطة بها صراحةً.` : 'حُذفت القطعة.');
}

function createJoint() {
  restoreCycleForEdit();
  const childId = selectedPartId;
  const parentId = ($('#joint-parent') as HTMLSelectElement).value;
  const kind = ($('#joint-kind') as HTMLSelectElement).value as AssemblyJoint['kind'];
  if (!childId || !parentId || childId === parentId) { showToast('اختر قطعة محددة وقطعة أب مختلفة.'); return; }
  const parentPart = project.parts.find((part) => part.id === parentId);
  const childPart = project.parts.find((part) => part.id === childId);
  if (!parentPart || !childPart) { showToast('تعذر العثور على طرفي علاقة التجميع.'); return; }
  if (project.joints.some((joint) => joint.childId === childId)) { showToast('للقطعة المحددة علاقة أب حالية؛ احذفها أو حررها قبل إنشاء علاقة أخرى.'); return; }
  const min = finite(($('#joint-min') as HTMLInputElement).value, 0);
  const max = finite(($('#joint-max') as HTMLInputElement).value, 0);
  if (kind !== 'fixed' && max <= min) { showToast('يجب أن يكون حد الحركة الأعلى أكبر من الأدنى.'); return; }
  const axis = ($('#joint-axis') as HTMLSelectElement).value as 'x' | 'y' | 'z';
  const parentEuler = new THREE.Euler(THREE.MathUtils.degToRad(parentPart.rotationDeg.x), THREE.MathUtils.degToRad(parentPart.rotationDeg.y), THREE.MathUtils.degToRad(parentPart.rotationDeg.z), 'XYZ');
  const childEuler = new THREE.Euler(THREE.MathUtils.degToRad(childPart.rotationDeg.x), THREE.MathUtils.degToRad(childPart.rotationDeg.y), THREE.MathUtils.degToRad(childPart.rotationDeg.z), 'XYZ');
  const parentQuaternion = new THREE.Quaternion().setFromEuler(parentEuler);
  const localOffset = new THREE.Vector3(childPart.positionMm.x - parentPart.positionMm.x, childPart.positionMm.y - parentPart.positionMm.y, childPart.positionMm.z - parentPart.positionMm.z).applyQuaternion(parentQuaternion.clone().invert());
  const relativeQuaternion = parentQuaternion.clone().invert().multiply(new THREE.Quaternion().setFromEuler(childEuler));
  const relativeEuler = new THREE.Euler().setFromQuaternion(relativeQuaternion, 'XYZ');
  project.joints.push({
    id: `joint-${Date.now().toString(36)}`, parentId, childId, kind,
    axis: axis === 'x' ? { x: 1, y: 0, z: 0 } : axis === 'y' ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 }, min, max,
    unit: kind === 'revolute' ? 'deg' : 'mm',
    referenceOffsetMm: { x: localOffset.x, y: localOffset.y, z: localOffset.z },
    referenceRotationDeg: { x: THREE.MathUtils.radToDeg(relativeEuler.x), y: THREE.MathUtils.radToDeg(relativeEuler.y), z: THREE.MathUtils.radToDeg(relativeEuler.z) },
  });
  workbench?.setProject(project);
  if (workbench) project = workbench.currentProject;
  renderAll(); pushHistory(); scheduleSave();
  showToast('تم إنشاء علاقة التجميع؛ تحقق من محور الارتباط وحدوده في النموذج.');
}

function goHistory(direction: -1 | 1) {
  const next = historyIndex + direction;
  if (next < 0 || next >= history.length) return;
  historyIndex = next;
  project = cloneProject(history[historyIndex]);
  speed = project.settings.cycleSpeed;
  workbench?.setProject(project);
  if (workbench) project = workbench.currentProject;
  cycleBase = null; cycleHasRun = false;
  renderAll(); scheduleSave(); updateHistoryButtons();
}

function initHistory() {
  history = [cloneProject(project)];
  historyIndex = 0;
  updateHistoryButtons();
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function exportProject() {
  const data = currentDesignSnapshot();
  data.updatedAt = new Date().toISOString();
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }), `${safeFilename(data.name)}.json`);
  showToast('تم تنزيل مشروع JSON؛ يبقى ملفك على جهازك.');
}
function safeFilename(value: string) { return value.toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, '-').replace(/^-|-$/g, '') || 'mechanical-project'; }

async function importProject(file: File) {
  try {
    const normalized = normalizeProject(JSON.parse(await file.text()));
    if (!normalized) throw new Error('invalid project');
    applyProject(normalized, true, 'تم فتح ملف المشروع المحلي.');
  } catch { showToast('تعذر فتح الملف؛ تأكد أنه JSON صادر من هذا المحرر وبنسخة مدعومة.'); }
}

function applyMotionTargets(targets: Array<{ partId: string; positionMm: Vec3 }>): boolean {
  if (!workbench) return false;
  motionApplying = true;
  try {
    for (const target of targets) {
      const part = project.parts.find((item) => item.id === target.partId);
      if (!part) continue;
      if (!workbench.applyPose(part.id, { positionMm: target.positionMm, rotationDeg: { ...part.rotationDeg } })) return false;
      project = workbench.currentProject;
    }
  } finally { motionApplying = false; }
  return true;
}

function ensureCycleBase() {
  if (!cycleBase) cycleBase = cloneProject(project);
}

function pauseCycle() {
  playing = false;
  window.clearInterval(cycleTimer);
  cycleTimer = 0;
  renderCycle();
}

function sensorIdForStep(index: number) { return SENSOR_IDS[index] ?? 'S1'; }

function startCycle() {
  if (playing) { pauseCycle(); return; }
  if (cycleHasRun) { showToast('انتهى عرض دورة واحدة؛ أعد الضبط قبل تكرارها حتى لا نخترع إخراجًا آليًا.'); return; }
  if (cycleMode !== 'auto') { showToast('اختر وضع «تلقائي» لتشغيل التسلسل خطوة بخطوة.'); return; }
  if (!workbench?.physicsReady) { showToast('انتظر تحميل محرك التصادم قبل بدء الحركة.'); return; }
  ensureCycleBase();
  playing = true;
  let previous = performance.now();
  cycleTimer = window.setInterval(() => {
    const now = performance.now();
    const delta = now - previous;
    previous = now;
    stepProgress = Math.min(1, stepProgress + delta / (1900 / speed));
    if (!applyMotionTargets(targetsForStep(cycleBase!, activeStep, stepProgress))) {
      pauseCycle();
      return;
    }
    renderCycle();
    if (stepProgress >= 1) {
      const sensor = sensorIdForStep(activeStep);
      if (!stepMotionComplete(cycleBase!, activeStep)) {
        pauseCycle();
        $('#controller-alert').textContent = `لم يكتمل مشوار المشغل في «${M01_STEPS[activeStep].title}». زِد سرعة هذا المشغل أو راجع المشوار قبل تأكيد الحساس.`;
        return;
      }
      if (!sensors[sensor]) {
        $('#controller-alert').textContent = `انتظار ${sensor}: أوقف التسلسل عند نهاية الخطوة؛ أعد الإشارة الافتراضية إذا اكتمل الموضع.`;
        pauseCycle();
        return;
      }
      $('#controller-alert').textContent = 'اكتمل المشوار الافتراضي والحساس المحدد؛ انتقل التسلسل للخطوة التالية.';
      if (activeStep === M01_STEPS.length - 1) {
        pauseCycle(); cycleHasRun = true;
        $('#controller-alert').textContent = 'اكتملت دورة عرض واحدة؛ أعد الضبط لتكرارها. لا يوجد إخراج آلي مضاف.';
        showToast('اكتملت الحركة التوضيحية. راجع الملاحظات والقياسات.');
        return;
      }
      activeStep += 1; stepProgress = 0; renderStepCards(); renderCycle();
    }
  }, 32);
  renderCycle();
}

function stepCycle() {
  if (playing || cycleHasRun) return;
  if (!workbench?.physicsReady) { showToast('انتظر تحميل محرك التصادم.'); return; }
  ensureCycleBase();
  const sensor = sensorIdForStep(activeStep);
  if (!applyMotionTargets(targetsForStep(cycleBase!, activeStep, 1))) return;
  stepProgress = 1;
  if (!stepMotionComplete(cycleBase!, activeStep)) {
    renderCycle();
    $('#controller-alert').textContent = `المشغل في «${M01_STEPS[activeStep].title}» لم يكتمل؛ لن تُتجاوز الخطوة تلقائيًا.`;
    return;
  }
  if (!sensors[sensor]) { $('#controller-alert').textContent = `الخطوة متوقفة بانتظار الإشارة ${sensor}.`; return; }
  $('#controller-alert').textContent = 'اكتمل المشوار الافتراضي والحساس المحدد؛ انتقل التسلسل للخطوة التالية.';
  if (activeStep === M01_STEPS.length - 1) {
    stepProgress = 1; cycleHasRun = true;
    $('#controller-alert').textContent = 'اكتملت دورة عرض واحدة؛ أعد الضبط لتكرارها.';
  } else { activeStep += 1; stepProgress = 0; }
  renderStepCards(); renderCycle(); scheduleSave();
}

function resetCycle() {
  pauseCycle();
  if (cycleBase) {
    project = cloneProject(cycleBase);
    workbench?.setProject(project);
    if (workbench) project = workbench.currentProject;
  }
  activeStep = 0; stepProgress = 0; cycleHasRun = false;
  cycleBase = null;
  outputs = Object.fromEntries(OUTPUTS.map((item) => [item.id, false]));
  renderAll(); setCollisionClear(); scheduleSave();
  showToast('عاد المجسم إلى حالة بداية الدورة المحفوظة.');
}

function outputPart(role: StudioPart['motionRole']) { return project.parts.find((part) => part.motionRole === role); }
function applyManualOutput(id: string, state: boolean) {
  if (!workbench || cycleMode !== 'manual') return;
  if (playing || cycleHasRun || stepProgress > 0 || activeStep > 0) restoreCycleForEdit();
  const base = cycleBase ?? cloneProject(project);
  cycleBase = base;
  let targets: Array<{ partId: string; positionMm: Vec3 }> = [];
  if (id === 'O1') {
    const pusher = outputPart('cap-pusher');
    if (pusher) targets.push({ partId: pusher.id, positionMm: { ...pusher.positionMm, x: (base.parts.find((part) => part.id === pusher.id)?.positionMm.x ?? pusher.positionMm.x) - (state ? project.settings.pusherStrokeMm : 0) } });
    project.parts.filter((part) => part.motionRole === 'cap').forEach((cap) => {
      const initial = base.parts.find((item) => item.id === cap.id);
      if (initial) targets.push({ partId: cap.id, positionMm: { ...cap.positionMm, x: initial.positionMm.x - (state ? project.settings.pusherStrokeMm : 0) } });
    });
  } else if (id === 'O2') {
    const gate = outputPart('glue-gate');
    if (gate) { const initial = base.parts.find((item) => item.id === gate.id); if (initial) targets.push({ partId: gate.id, positionMm: { ...gate.positionMm, x: initial.positionMm.x + (state ? 14 : 0) } }); }
  } else if (id === 'O3') {
    const slide = outputPart('washer-slide');
    if (slide) { const initial = base.parts.find((item) => item.id === slide.id); if (initial) targets.push({ partId: slide.id, positionMm: { ...slide.positionMm, z: initial.positionMm.z - (state ? project.settings.slideStrokeMm : 0) } }); }
  } else if (id === 'O4') {
    const head = outputPart('press-head');
    const initial = head ? base.parts.find((part) => part.id === head.id) : undefined;
    if (head && initial) {
      const target = { ...initial.positionMm, y: initial.positionMm.y - (state ? project.settings.pressStrokeMm : 0) };
      targets.push({ partId: head.id, positionMm: target });
      const washer = outputPart('washer');
      if (washer && outputs.O5) targets.push({ partId: washer.id, positionMm: { x: target.x, y: target.y - head.sizeMm.y / 2 - washer.sizeMm.y / 2, z: target.z } });
    }
  } else if (id === 'O5') {
    const washer = outputPart('washer'); const head = outputPart('press-head');
    const initial = washer ? base.parts.find((part) => part.id === washer.id) : undefined;
    if (washer && initial) {
      const held = state && head ? { x: head.positionMm.x, y: head.positionMm.y - head.sizeMm.y / 2 - washer.sizeMm.y / 2, z: head.positionMm.z } : initial.positionMm;
      targets.push({ partId: washer.id, positionMm: { ...held } });
    }
  }
  if (applyMotionTargets(targets)) {
    outputs[id] = state;
    renderIo(); renderInspector(); renderTree();
    $('#controller-alert').textContent = 'تغير خرج افتراضي؛ لا يتصل هذا التحكم بصمام أو PLC حقيقي.';
  } else {
    outputs[id] = !state; renderIo();
  }
}

function switchPanel(panelId: string) {
  if (!['design-panel', 'simulation-panel', 'reference-panel'].includes(panelId)) return;
  currentPanel = panelId;
  renderPanelState();
}

function measureForce() {
  const pressureBar = finite(($('#pressure-input') as HTMLInputElement).value, 0);
  const boreMm = finite(($('#bore-input') as HTMLInputElement).value, 0);
  const output = $('#force-output');
  if (pressureBar <= 0 || boreMm <= 0) { output.textContent = '— نيوتن'; return; }
  const force = pressureBar * 100000 * Math.PI * Math.pow(boreMm / 1000, 2) / 4;
  output.textContent = `${force.toFixed(1)} نيوتن*`;
}

function bindEvents() {
  $('#new-project').addEventListener('click', () => applyProject(makeBlankProject(), true, 'بدأت مشروعًا فارغًا.'));
  $('#load-m01').addEventListener('click', () => applyProject(makeM01Project(), true, 'تم تحميل قالب M-01 التمثيلي.'));
  $('#save-project').addEventListener('click', () => saveLocal(true));
  $('#export-project').addEventListener('click', exportProject);
  $('#import-project').addEventListener('change', (event) => {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (file) void importProject(file);
    (event.currentTarget as HTMLInputElement).value = '';
  });
  $('#project-name').addEventListener('change', (event) => {
    project.name = (event.currentTarget as HTMLInputElement).value.trim().slice(0, 120) || 'مشروع ميكانيكي جديد';
    if (workbench) workbench.currentProject.name = project.name;
    project = workbench?.currentProject ?? project;
    pushHistory(); scheduleSave();
  });
  $('#undo').addEventListener('click', () => goHistory(-1));
  $('#redo').addEventListener('click', () => goHistory(1));
  $('#add-part').addEventListener('click', addSelectedPart);
  $('#duplicate-part').addEventListener('click', duplicateSelectedPart);
  $('#delete-part').addEventListener('click', deleteSelectedPart);
  $('#toggle-visibility').addEventListener('click', () => {
    if (!selectedPartId || !workbench) return;
    restoreCycleForEdit();
    const part = project.parts.find((item) => item.id === selectedPartId);
    if (!part) return;
    workbench.setVisibility(part.id, !part.visible);
    project = workbench.currentProject; renderAll(); pushHistory(); scheduleSave();
  });
  $('#fixed-lock').addEventListener('change', (event) => {
    if (!selectedPartId || !workbench) return;
    const fixed = (event.currentTarget as HTMLInputElement).checked;
    restoreCycleForEdit(); workbench.setFixed(selectedPartId, fixed);
    project = workbench.currentProject; pushHistory(); scheduleSave(); renderInspector();
  });
  $('#measured-toggle').addEventListener('change', (event) => {
    const measured = (event.currentTarget as HTMLInputElement).checked;
    restoreCycleForEdit();
    const part = selectedPartId ? project.parts.find((item) => item.id === selectedPartId) : undefined;
    if (!part) return;
    part.confidence = measured ? 'measured' : 'illustrative';
    project = workbench?.currentProject ?? project;
    renderInspector(); renderTree(); pushHistory(); scheduleSave();
  });
  $('#apply-dimensions').addEventListener('click', () => applySelectedSize(undefined, ($('#measured-toggle') as HTMLInputElement).checked));
  $$<HTMLInputElement>('[data-size-axis], #inner-diameter').forEach((input) => input.addEventListener('keydown', (event) => { if (event.key === 'Enter') applySelectedSize(undefined, ($('#measured-toggle') as HTMLInputElement).checked); }));
  $$<HTMLButtonElement>('[data-size-nudge]').forEach((button) => button.addEventListener('click', () => {
    const [axis, sign] = (button.dataset.sizeNudge ?? '').split('');
    if (axis === 'x' || axis === 'y' || axis === 'z') nudgeSize(axis, sign === '+' ? 1 : -1);
  }));
  $$<HTMLInputElement>('[data-pos-axis], [data-rot-axis]').forEach((input) => input.addEventListener('change', applySelectedPoseFromInputs));
  $$('.axis-selector button').forEach((button) => button.addEventListener('click', () => {
    axisSelected = button.dataset.axis as 'x' | 'y' | 'z';
    $$('.axis-selector button').forEach((item) => item.classList.toggle('active', item === button));
    ($('#axis-value') as HTMLInputElement).placeholder = `إزاحة موجّهة لمحور ${axisSelected.toUpperCase()} (مم)`;
  }));
  $('#apply-axis-value').addEventListener('click', () => {
    if (!selectedPartId || !workbench) return;
    const text = ($('#axis-value') as HTMLInputElement).value.trim();
    if (!text) { showToast('اكتب مقدار الإزاحة بالملليمتر أولًا.'); return; }
    const delta = finite(text, 0);
    restoreCycleForEdit();
    const part = project.parts.find((item) => item.id === selectedPartId);
    if (!part) return;
    const positionMm = { ...part.positionMm, [axisSelected]: part.positionMm[axisSelected] + delta };
    if (workbench.applyPose(part.id, { positionMm, rotationDeg: { ...part.rotationDeg } })) {
      project = workbench.currentProject; renderInspector(); renderTree(); pushHistory(); scheduleSave(); setCollisionClear();
    }
  });
  $$<HTMLButtonElement>('[data-nudge]').forEach((button) => button.addEventListener('click', () => {
    const [axis, sign] = (button.dataset.nudge ?? '').split('');
    if (axis === 'x' || axis === 'y' || axis === 'z') nudgePosition(axis, sign === '+' ? 10 : -10);
  }));
  $('#create-joint').addEventListener('click', createJoint);
  $('#joint-list').addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-joint-delete]');
    if (!button) return;
    restoreCycleForEdit();
    project.joints = project.joints.filter((joint) => joint.id !== button.dataset.jointDelete);
    workbench?.setProject(project);
    if (workbench) project = workbench.currentProject;
    renderAll(); pushHistory(); scheduleSave();
    showToast('فُكّت علاقة التجميع المحددة.');
  });
  $('#part-tree').addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const select = target.closest<HTMLElement>('[data-tree-select]');
    const visibility = target.closest<HTMLElement>('[data-tree-visibility]');
    if (visibility && workbench) {
      restoreCycleForEdit();
      const part = project.parts.find((item) => item.id === visibility.dataset.treeVisibility);
      if (part) { workbench.setVisibility(part.id, !part.visible); project = workbench.currentProject; renderAll(); pushHistory(); scheduleSave(); }
      return;
    }
    if (select && workbench) { workbench.selectPart(select.dataset.treeSelect ?? null); selectedPartId = select.dataset.treeSelect ?? null; renderTree(); renderInspector(); }
  });
  $$('.panel-tab').forEach((button) => button.addEventListener('click', () => switchPanel(button.dataset.panel ?? 'design-panel')));
  $$<HTMLAnchorElement>('[data-open-panel]').forEach((link) => link.addEventListener('click', (event) => { event.preventDefault(); switchPanel('reference-panel'); $('#engineering-notes').scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
  $$<HTMLButtonElement>('[data-mode]').forEach((button) => button.addEventListener('click', () => {
    const mode = button.dataset.mode as 'translate' | 'rotate' | 'scale';
    workbench?.setMode(mode);
    $$('[data-mode]').forEach((item) => item.classList.toggle('active', item === button));
  }));
  $$<HTMLButtonElement>('[data-camera]').forEach((button) => button.addEventListener('click', () => workbench?.setCamera(button.dataset.camera as 'iso' | 'top' | 'front')));
  $('#reset-camera').addEventListener('click', () => workbench?.resetCamera());
  $$('.cycle-step-button').forEach((button) => button.addEventListener('click', () => undefined));
  $('#cycle-step-list').addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-cycle-index]');
    if (!button || playing || cycleHasRun) return;
    const next = Number(button.dataset.cycleIndex);
    if (!Number.isInteger(next) || next < 0 || next >= M01_STEPS.length) return;
    if (next !== activeStep) { showToast('لا يمكن تخطي حركة سابقة؛ شغّل الخطوات بالتتابع أو أعد ضبط الدورة.'); return; }
  });
  $('#cycle-play').addEventListener('click', startCycle);
  $('#cycle-step').addEventListener('click', stepCycle);
  $('#cycle-reset').addEventListener('click', resetCycle);
  $('#cycle-speed').addEventListener('input', (event) => {
    speed = Math.min(2, Math.max(0.25, finite((event.currentTarget as HTMLInputElement).value, 1)));
    project.settings.cycleSpeed = speed;
    if (cycleBase) cycleBase.settings.cycleSpeed = speed;
    $('#speed-readout').textContent = `${speed.toFixed(2)}×`;
    scheduleSave();
  });
  $('#cycle-speed').addEventListener('change', () => { if (!cycleBase) pushHistory(); });
  $$<HTMLInputElement>('[data-actuator-speed]').forEach((input) => {
    input.addEventListener('input', () => {
      const key = input.dataset.actuatorSpeed as keyof ActuatorSpeeds;
      if (!(key in project.settings.actuatorSpeeds)) return;
      const value = Math.min(2, Math.max(0.25, finite(input.value, 1)));
      input.value = String(value);
      project.settings.actuatorSpeeds[key] = value;
      if (cycleBase) cycleBase.settings.actuatorSpeeds[key] = value;
      const readout = document.querySelector<HTMLOutputElement>(`[data-speed-readout="${key}"]`);
      if (readout) readout.value = `${value.toFixed(2)}×`;
      scheduleSave();
    });
    input.addEventListener('change', () => { if (!cycleBase) pushHistory(); });
  });
  $$('.controller-mode-buttons button').forEach((button) => button.addEventListener('click', () => {
    const next = button.getAttribute('data-control-mode') as 'auto' | 'manual';
    if (next === 'manual') pauseCycle();
    if (next === 'auto' && cycleMode === 'manual' && cycleBase && OUTPUTS.some((output) => outputs[output.id])) restoreCycleForEdit();
    cycleMode = next; renderIo(); renderCycle();
    $('#controller-alert').textContent = next === 'manual' ? 'الخرج اليدوي يحرّك مشهدًا افتراضيًا فقط.' : 'التسلسل ينتظر إشارات حساسات افتراضية.';
  }));
  $('#output-grid').addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-output]');
    if (!button || cycleMode !== 'manual') return;
    const id = button.dataset.output ?? '';
    applyManualOutput(id, !outputs[id]);
  });
  $('#sensor-grid').addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-sensor]');
    if (!button) return;
    const id = button.dataset.sensor ?? '';
    sensors[id] = !sensors[id]; renderIo();
    if (!sensors[id]) $('#controller-alert').textContent = `تم تعطيل ${id}; سيتوقف التسلسل عند انتظار هذه الإشارة.`;
    else $('#controller-alert').textContent = `${id} = 1 افتراضيًا. لا تعني الإشارة تأكيد حساس حقيقي.`;
  });
  $('#pressure-input').addEventListener('input', measureForce);
  $('#bore-input').addEventListener('input', measureForce);
  $('#try-landscape').addEventListener('click', async () => {
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      const orientation = screen.orientation as ScreenOrientation & { lock?: (orientation: string) => Promise<void> };
      if (orientation.lock) { await orientation.lock('landscape'); showToast('طُلب قفل الاتجاه؛ يمكن للجهاز رفض الطلب.'); }
      else showToast('هذا المتصفح لا يدعم قفل الاتجاه؛ أدر الهاتف يدويًا.');
    } catch { showToast('رفض المتصفح ملء الشاشة/قفل الاتجاه؛ أدر الهاتف أفقيًا يدويًا.'); }
  });
  let recording: ReturnType<MechanicalWorkbench['startCanvasRecording']> | null = null;
  const toggleRecording = async () => {
    if (!workbench) return;
    if (recording) {
      recording.stop();
      $('#record-status').textContent = 'جارٍ إنهاء ملف الفيديو…';
      return;
    }
    try {
      const session = workbench.startCanvasRecording();
      recording = session;
      $$<HTMLButtonElement>('#record-video, #capture-video').forEach((button) => { button.textContent = 'إيقاف التسجيل'; });
      $('#record-status').textContent = 'جارٍ التسجيل؛ اضغط إيقاف أو انتظر حد 30 ثانية…';
      const blob = await session.done;
      recording = null;
      $$<HTMLButtonElement>('#record-video, #capture-video').forEach((button) => { button.textContent = 'تسجيل WebM'; });
      downloadBlob(blob, 'm01-viewport-recording.webm');
      $('#record-status').textContent = 'اكتمل ملف WebM من تسجيل الشاشة الحالي.';
      showToast('تم تنزيل تسجيل WebM للمشهد المعروض.');
    } catch {
      recording = null;
      $$<HTMLButtonElement>('#record-video, #capture-video').forEach((button) => { button.textContent = 'تسجيل WebM'; });
      $('#record-status').textContent = 'التسجيل غير مدعوم في هذا المتصفح أو فشل البدء.';
      showToast('تعذر تسجيل WebM في المتصفح الحالي.');
    }
  };
  $('#record-video').addEventListener('click', () => { void toggleRecording(); });
  $('#capture-video').addEventListener('click', () => { void toggleRecording(); });
}

function start() {
  let migratedOnLoad = false;
  try { migratedOnLoad = !localStorage.getItem(PROJECT_KEY) && Boolean(localStorage.getItem(LEGACY_KEY)); } catch { /* Browser storage may be blocked. */ }
  renderCatalog();
  $('#pneumatic-diagram').innerHTML = pneumaticDiagram();
  $('#control-diagram').innerHTML = controlDiagram();
  workbench = new MechanicalWorkbench($('#viewport-mount'), project, {
    onSelect: (part) => { selectedPartId = part?.id ?? null; renderTree(); renderInspector(); },
    onChanged: (part, final) => {
      if (!workbench) return;
      project = workbench.currentProject;
      renderInspector();
      if (final && !motionApplying) {
        pushHistory(); renderTree(); scheduleSave();
      }
    },
    onCollision: reportCollision,
    onPhysics: renderPhysics,
    onBeforeEdit: () => { if (cycleHasRun) restoreCycleForEdit(); },
  });
  project = workbench.currentProject;
  bindEvents();
  renderAll();
  initHistory();
  workbench.selectPart(project.parts.find((part) => part.motionRole === 'cap-pusher')?.id ?? project.parts[0]?.id ?? null);
  if (migratedOnLoad) { saveLocal(false); showToast('تم نقل إعداداتك السابقة إلى قالب M-01 الجديد. راجع شارات القياس.'); }
}

start();
