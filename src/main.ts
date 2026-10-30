import { Workbench3D } from './scene/Workbench3D';
import {
  calculateChannelFit,
  DATA_TO_COLLECT,
  DIMENSIONS,
  EMPTY_DESIGN,
  FAULT_GUIDE,
  filledDimensionCount,
  normalizeDesign,
  OPEN_DECISIONS,
  PARTS,
  type DesignState,
  type DimensionKey,
  type LayoutMode,
} from './model/project';
import { CYCLE_STEPS } from './simulation/cycle';
import { controlDiagram, pneumaticDiagram } from './ui/diagrams';

const STORAGE_KEY = 'm01-design-studio-v1';
const appRoot = document.querySelector<HTMLElement>('#app');
if (!appRoot) throw new Error('Application root is missing.');
const app: HTMLElement = appRoot;

function readSavedDesign(): DesignState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizeDesign(JSON.parse(raw)) ?? structuredClone(EMPTY_DESIGN);
  } catch {
    // A malformed or unavailable local-storage record must not block the page.
  }
  return structuredClone(EMPTY_DESIGN);
}

let design = readSavedDesign();
let workbench: Workbench3D | null = null;
let selectedPartId: string | null = null;
let activeCycle = 0;
let cycleProgress = 0;
let cycleTimer = 0;
let toastTimer = 0;
let saveTimer = 0;
let playing = false;

const $ = <T extends HTMLElement = HTMLElement>(selector: string, parent: ParentNode = document) => {
  const node = parent.querySelector<T>(selector);
  if (!node) throw new Error(`Required element not found: ${selector}`);
  return node;
};
const $$ = <T extends HTMLElement = HTMLElement>(selector: string, parent: ParentNode = document) => Array.from(parent.querySelectorAll<T>(selector));

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}

function showToast(message: string) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 2400);
}

function saveLocal(showMessage = true) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(design));
    if (showMessage) showToast('تم حفظ إعداد التصميم على هذا الجهاز.');
  } catch {
    showToast('تعذر الحفظ المحلي؛ تحقق من مساحة المتصفح أو إعداداته.');
  }
}

function scheduleSave() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => saveLocal(false), 250);
}

function applyDesignToForm() {
  $$<HTMLInputElement>('[data-dimension]').forEach((input) => {
    const key = input.dataset.dimension as DimensionKey;
    const value = design.measurements[key];
    input.value = value === undefined ? '' : String(value);
  });
  $$<HTMLButtonElement>('[data-layout]').forEach((button) => button.classList.toggle('active', button.dataset.layout === design.layout));
  $$<HTMLButtonElement>('[data-head-mode]').forEach((button) => button.classList.toggle('active', button.dataset.headMode === design.headMode));
}

function updateReadiness() {
  const count = filledDimensionCount(design);
  const label = $('#readiness-label');
  label.textContent = count === 0 ? 'بيانات المنتج لم تُدخل بعد' : `${count} من ${DIMENSIONS.length} قياسًا/مدخلًا أُدخل`;
  const fit = calculateChannelFit(design);
  const fitBox = $('#channel-fit');
  fitBox.className = `fit-result ${fit.kind}`;
  fitBox.innerHTML = `<span class="fit-icon">↔</span><span>${escapeHtml(fit.label)}</span>`;
  const metricMode = design.measurements.capOuterDiameter && design.measurements.channelLength;
  $('#scene-scale-label').textContent = metricMode
    ? 'مقياس الأجزاء المقاسة: 1 وحدة مشهد = 100 مم · بقية الأبعاد تمثيلية'
    : 'المقياس: تصوري — أدخل قياساتك';
}

function componentForPart(id: string) {
  return PARTS.find((part) => part.id === id);
}

function displayPart(partId: string | null) {
  const part = partId ? componentForPart(partId) : undefined;
  const visibilityButton = document.querySelector<HTMLButtonElement>('#toggle-selected-part');
  selectedPartId = part?.id ?? null;
  if (!part) {
    $('#inspector-icon').textContent = 'M1';
    $('#selected-part-name').textContent = 'اختر جزءًا من المجسم';
    $('#selected-part-description').textContent = 'يمكنك أيضًا اختيار جزء من القائمة أدناه لمعرفة وظيفته والقياسات والبيانات التي تحتاج إلى جمعها.';
    $('#selected-part-status').textContent = 'غير محدد';
    if (visibilityButton) visibilityButton.disabled = true;
  } else {
    $('#inspector-icon').textContent = part.code.split(' ')[0].slice(0, 5);
    $('#selected-part-name').textContent = part.name;
    $('#selected-part-description').textContent = part.role;
    const hidden = workbench?.isPartHidden(part.id) ?? false;
    $('#selected-part-status').textContent = hidden ? 'مخفي مؤقتًا' : part.status === 'known' ? 'مبدأ محدد' : part.status === 'concept' ? 'تمثيل بصري' : 'بحاجة لاعتماد';
    if (visibilityButton) {
      visibilityButton.disabled = !workbench;
      visibilityButton.textContent = hidden ? 'إظهار الجزء' : 'إخفاء الجزء';
    }
  }
  $$('.module-card').forEach((card) => card.classList.toggle('selected', card.getAttribute('data-part') === selectedPartId));
  $$('.part-card').forEach((card) => card.classList.toggle('selected', card.getAttribute('data-part') === selectedPartId));
  workbench?.setSelectedPart(selectedPartId);
}

function renderParts() {
  const strip = $('#module-strip');
  strip.innerHTML = PARTS.map((part) => `<button class="module-card" data-part="${escapeHtml(part.id)}" type="button">
    <span class="module-code">${escapeHtml(part.code)}</span><strong>${escapeHtml(part.name)}</strong><small>${escapeHtml(part.role)}</small>
  </button>`).join('');

  $('#parts-grid').innerHTML = PARTS.map((part) => `<article class="part-card" data-part="${escapeHtml(part.id)}">
    <div class="part-head"><div><span class="part-code">${escapeHtml(part.code)} · ${escapeHtml(part.technicalName)}</span><h3>${escapeHtml(part.name)}</h3></div><span class="unknown-tag">${part.status === 'known' ? 'مبدأ محدد' : 'يحتاج تحديدًا'}</span></div>
    <p>${escapeHtml(part.role)}</p>
    <div class="part-meta"><div><strong>ما تقيسه/تحدده</strong><ul>${part.measureNeeds.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div><div><strong>ما تتحقق منه لدى المورد</strong><ul>${part.supplierChecks.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div></div>
    ${part.safetyNote ? `<div class="part-safety">${escapeHtml(part.safetyNote)}</div>` : ''}
  </article>`).join('');

  $('#decision-list').innerHTML = OPEN_DECISIONS.map((item, index) => `<div class="decision-row"><i>${String(index + 1).padStart(2, '0')}</i><span>${escapeHtml(item)}</span></div>`).join('');
  $('#data-checklist').innerHTML = DATA_TO_COLLECT.map((item) => `<div class="data-check"><i aria-hidden="true"></i><span>${escapeHtml(item)}</span></div>`).join('');
  $('#fault-guide-grid').innerHTML = FAULT_GUIDE.map((item) => `<article class="fault-card"><h3>${escapeHtml(item.symptom)}</h3><p><strong>سجّل/تحقق:</strong> ${escapeHtml(item.check)}</p><p class="fault-safe"><strong>أمان:</strong> ${escapeHtml(item.safe)}</p></article>`).join('');
}

function switchView(viewId: string) {
  $$('.view').forEach((view) => view.classList.toggle('active', view.id === `view-${viewId}`));
  $$('.nav-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.view === viewId));
  if (viewId === 'design') requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  if (viewId === 'parts' && selectedPartId) {
    const card = document.querySelector<HTMLElement>(`.part-card[data-part="${CSS.escape(selectedPartId)}"]`);
    card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function buildCycleStepCards() {
  $('#cycle-step-list').innerHTML = CYCLE_STEPS.map((item, itemIndex) => `<button type="button" class="cycle-step-card" data-cycle-index="${itemIndex}"><span>${String(itemIndex + 1).padStart(2, '0')}</span><strong>${escapeHtml(item.title)}</strong></button>`).join('');
}

function setLayout(layout: LayoutMode) {
  design.layout = layout;
  $$<HTMLButtonElement>('[data-layout]').forEach((button) => button.classList.toggle('active', button.dataset.layout === layout));
  workbench?.setLayout(layout);
  const layoutText: Record<LayoutMode, [string, string]> = {
    linear: ['التخطيط الخطي', 'ترتيب واضح للمحطات حول مسار مستقيم. مسار صف الأغطية مستقيم، ولا يعني ذلك أن طول المسار أو مواضع المحطات معتمدة.'],
    L: ['توزيع محطات على شكل L', 'يغيّر هذا العرض توزيع الوحدات حول قاعدة العمل فقط؛ يظل صف الأغطية ومجرى U مستقيمين. أي تغيير لمسار المنتج يحتاج دراسة وموافقة مستقلة.'],
    U: ['توزيع محطات على شكل U', 'يُظهر هذا العرض تجميع الخدمات والوحدات حول مساحة العمل؛ لا يعني وجود قرص دوار أو سير أو مسار أغطية منحني.'],
  };
  $('#layout-note-title').textContent = layoutText[layout][0];
  $('#layout-note-text').textContent = layoutText[layout][1];
  scheduleSave();
}

function bindDimensions() {
  $$<HTMLInputElement>('[data-dimension]').forEach((input) => {
    input.addEventListener('input', () => {
      const key = input.dataset.dimension as DimensionKey;
      const value = input.value.trim() === '' ? undefined : Number(input.value);
      if (value !== undefined && (!Number.isFinite(value) || value <= 0 || value > 10_000_000)) {
        input.setCustomValidity('أدخل رقمًا موجبًا معقولًا بوحدة المليمتر.');
        input.reportValidity();
        return;
      }
      input.setCustomValidity('');
      if (value === undefined) delete design.measurements[key];
      else design.measurements[key] = value;
      updateReadiness();
      workbench?.updateDesign(design);
      scheduleSave();
    });
    input.addEventListener('focus', () => {
      const def = DIMENSIONS.find((item) => item.key === input.dataset.dimension);
      if (def) showToast(def.whatToMeasure);
    });
  });
}

function exportDesign() {
  const data = { ...design, exportedAt: new Date().toISOString(), title: 'إعداد تصميم ماكينة M-01' };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  downloadBlob(blob, 'm01-design.json');
  showToast('تم تنزيل ملف إعدادات التصميم بصيغة JSON.');
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportChecklistCsv() {
  const rows = [['المجموعة', 'اسم الجزء', 'المعلومة/المقاس', 'القيمة المدخلة', 'ما يجب التحقق منه']];
  for (const part of PARTS) {
    const dimensionNames = DIMENSIONS.filter((dimension) => dimension.partId === part.id);
    if (!dimensionNames.length) {
      rows.push([part.code, part.name, 'القياسات اللازمة', '', part.measureNeeds.join('؛ ') + ' | المورد: ' + part.supplierChecks.join('؛ ')]);
    } else {
      for (const dimension of dimensionNames) {
        const value = design.measurements[dimension.key];
        rows.push([part.code, part.name, `${dimension.name} (${dimension.symbol})`, value ? `${value} مم` : 'غير مدخل', `${dimension.whatToMeasure} | ${part.supplierChecks.join('؛ ')}`]);
      }
    }
  }
  const csv = '\ufeff' + rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'm01-parts-and-measurements.csv');
  showToast('تم تنزيل قائمة التحقق CSV.');
}

function renderCycleStep(index: number, progress = 0) {
  const step = CYCLE_STEPS[index];
  if (!step) return;
  activeCycle = index;
  cycleProgress = progress;
  $('#cycle-step-number').textContent = `الخطوة ${index + 1} من ${CYCLE_STEPS.length}`;
  $('#cycle-step-title').textContent = step.title;
  $('#cycle-step-description').textContent = step.description;
  $('#cycle-parts').textContent = step.parts;
  $('#cycle-sensor').textContent = step.sensor;
  const caution = $('#cycle-caution');
  caution.textContent = step.caution ?? '';
  caution.classList.toggle('is-hidden', !step.caution);
  $('#cycle-state-label').textContent = playing ? `جارٍ العرض · ${step.title}` : `متوقف · ${step.title}`;
  $('#cycle-live-dot').parentElement?.classList.toggle('running', playing);
  $('#cycle-progress-bar').style.width = `${((index + progress) / CYCLE_STEPS.length) * 100}%`;
  $('#cycle-play').textContent = playing ? 'إيقاف مؤقت' : 'تشغيل العرض';
  $$('.cycle-step-card').forEach((button) => {
    const itemIndex = Number(button.getAttribute('data-cycle-index'));
    button.classList.toggle('active', itemIndex === index);
    button.classList.toggle('done', itemIndex < index);
  });
  workbench?.setCycle(step.id, progress);
  const nextPart = partIdFromCycle(index);
  if (nextPart !== selectedPartId) displayPart(nextPart);
}

function partIdFromCycle(index: number): string | null {
  const mapping = ['controls', 'capPusher', 'glueUnit', 'transferSlide', 'vacuumPressHead', 'vacuumPressHead', 'controls', 'outputZone'];
  return mapping[index] ?? null;
}

function pauseCycle() {
  playing = false;
  window.clearInterval(cycleTimer);
  const state = $('#cycle-state-label');
  state.textContent = `متوقف · ${CYCLE_STEPS[activeCycle].title}`;
  $('#cycle-live-dot').parentElement?.classList.remove('running');
  $('#cycle-play').textContent = 'استكمال العرض';
}

function nextCycleStep() {
  pauseCycle();
  const next = (activeCycle + 1) % CYCLE_STEPS.length;
  renderCycleStep(next, 0);
}

function startCycle() {
  if (playing) {
    pauseCycle();
    return;
  }
  if (activeCycle === CYCLE_STEPS.length - 1 && cycleProgress >= 1) renderCycleStep(0, 0);
  playing = true;
  $('#cycle-live-dot').parentElement?.classList.add('running');
  $('#cycle-play').textContent = 'إيقاف مؤقت';
  const stepDuration = 1850;
  let last = performance.now();
  cycleTimer = window.setInterval(() => {
    const now = performance.now();
    cycleProgress += (now - last) / stepDuration;
    last = now;
    if (cycleProgress >= 1) {
      if (activeCycle >= CYCLE_STEPS.length - 1) {
        cycleProgress = 1;
        renderCycleStep(activeCycle, 1);
        pauseCycle();
        showToast('انتهى العرض عند قرار إخراج المنتج المفتوح.');
        return;
      }
      const next = activeCycle + 1;
      renderCycleStep(next, 0);
      cycleProgress = 0;
    }
    renderCycleStep(activeCycle, cycleProgress);
  }, 40);
}

function calculateForce() {
  const pressure = Number(($('#pressure-input') as HTMLInputElement).value);
  const bore = Number(($('#bore-input') as HTMLInputElement).value);
  const rodText = ($('#rod-input') as HTMLInputElement).value.trim();
  const output = $('#force-output');
  const returnOutput = $('#return-output');
  if (!Number.isFinite(pressure) || !Number.isFinite(bore) || pressure <= 0 || bore <= 0) {
    output.textContent = '— نيوتن';
    returnOutput.textContent = 'أدخل ضغطًا وقطرًا فعليين لحساب نظري.';
    return;
  }
  const pressurePa = pressure * 100_000;
  const boreM = bore / 1000;
  const area = Math.PI * boreM * boreM / 4;
  const extension = pressurePa * area;
  output.textContent = `${extension.toFixed(1)} نيوتن`;
  if (rodText) {
    const rod = Number(rodText);
    if (!Number.isFinite(rod) || rod < 0 || rod >= bore) {
      returnOutput.textContent = 'يجب أن يكون قطر العمود أقل من قطر البستم؛ راجع القيم.';
      return;
    }
    const rodM = rod / 1000;
    const returnArea = Math.PI * (boreM * boreM - rodM * rodM) / 4;
    returnOutput.textContent = `قوة رجوع نظرية: ${(pressurePa * returnArea).toFixed(1)} نيوتن · قبل الفواقد`;
  } else returnOutput.textContent = 'قوة الرجوع: أدخل قطر العمود؛ القوة الفعلية أقل بسبب الفواقد.';
}

function createHeadModeSwitch() {
  const switcher = document.createElement('div');
  switcher.className = 'head-mode-switch';
  switcher.setAttribute('role', 'group');
  switcher.setAttribute('aria-label', 'عرض بدائل رأس الالتقاط والكبس');
  switcher.innerHTML = `<span>ترتيب الرأس:</span><button type="button" data-head-mode="combined">رأس واحد يجمع الوظيفة</button><button type="button" data-head-mode="separate">التقاط وكبس منفصلان</button><small>بدائل للمقارنة فقط — القرار مفتوح</small>`;
  $('.viewport-toolbar').after(switcher);
  $$<HTMLButtonElement>('[data-head-mode]', switcher).forEach((button) => button.addEventListener('click', () => {
    design.headMode = button.dataset.headMode === 'separate' ? 'separate' : 'combined';
    applyDesignToForm();
    workbench?.updateDesign(design);
    scheduleSave();
  }));
}

function createVisibilityButton() {
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'toggle-selected-part';
  button.className = 'button button-quiet';
  button.textContent = 'إخفاء الجزء';
  button.disabled = true;
  $('.inspector-action').prepend(button);
  button.addEventListener('click', () => {
    if (!selectedPartId || !workbench) return;
    const hidden = workbench.togglePartVisibility(selectedPartId);
    displayPart(selectedPartId);
    showToast(hidden ? 'أُخفي الجزء من العرض فقط؛ لم يُحذف من التصميم.' : 'عاد الجزء إلى العرض.');
  });
}

function bindEvents() {
  app.addEventListener('click', (event) => {
    const card = (event.target as HTMLElement).closest<HTMLElement>('[data-part]');
    if (!card) return;
    const partId = card.dataset.part;
    if (partId) displayPart(partId);
  });
  $('#cycle-step-list').addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-cycle-index]');
    if (!button) return;
    pauseCycle();
    const next = Number(button.dataset.cycleIndex);
    renderCycleStep(next, 0);
  });
  $$('.nav-tab').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view ?? 'design')));
  $$<HTMLButtonElement>('[data-layout]').forEach((button) => button.addEventListener('click', () => setLayout((button.dataset.layout as LayoutMode) ?? 'linear')));
  $$<HTMLButtonElement>('[data-camera]').forEach((button) => button.addEventListener('click', () => workbench?.setCamera((button.dataset.camera as 'iso' | 'top' | 'front') ?? 'iso')));
  $('#reset-camera').addEventListener('click', () => workbench?.resetCamera());
  $('#save-project').addEventListener('click', () => saveLocal(true));
  $('#export-project').addEventListener('click', exportDesign);
  $('#import-project').addEventListener('change', async (event) => {
    const target = event.currentTarget as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;
    try {
      const incoming = normalizeDesign(JSON.parse(await file.text()));
      if (!incoming) throw new Error('Unexpected project shape');
      design = incoming;
      applyDesignToForm();
      updateReadiness();
      workbench?.updateDesign(design);
      saveLocal(false);
      showToast('تم استيراد إعدادات التصميم.');
    } catch {
      showToast('تعذر قراءة الملف. اختر ملف JSON صادرًا من ورشة M-01.');
    } finally {
      target.value = '';
    }
  });
  $('#clear-measurements').addEventListener('click', () => {
    design.measurements = {};
    applyDesignToForm();
    updateReadiness();
    workbench?.updateDesign(design);
    scheduleSave();
    showToast('تم مسح القياسات المدخلة من النموذج.');
  });
  $('#open-parts').addEventListener('click', () => switchView('parts'));
  $('#cycle-play').addEventListener('click', startCycle);
  $('#cycle-step').addEventListener('click', nextCycleStep);
  $('#cycle-reset').addEventListener('click', () => {
    pauseCycle();
    renderCycleStep(0, 0);
    showToast('عاد عرض الدورة إلى البداية.');
  });
  $('#download-bom').addEventListener('click', exportChecklistCsv);
  $('#pressure-input').addEventListener('input', calculateForce);
  $('#bore-input').addEventListener('input', calculateForce);
  $('#rod-input').addEventListener('input', calculateForce);
  bindDimensions();
}

function init() {
  applyDesignToForm();
  renderParts();
  updateReadiness();
  $('#pneumatic-diagram').innerHTML = pneumaticDiagram();
  $('#control-diagram').innerHTML = controlDiagram();
  createHeadModeSwitch();
  createVisibilityButton();
  applyDesignToForm();
  try {
    workbench = new Workbench3D($('#three-mount'), design, displayPart);
  } catch (error) {
    console.error('3D scene could not be initialized', error);
    $('#three-mount').innerHTML = '<div class="webgl-fallback"><strong>تعذر تشغيل العرض ثلاثي الأبعاد في هذا المتصفح.</strong><span>جرّب متصفحًا حديثًا يدعم WebGL، أو افتح الموقع على جهاز يدعم تسريع الرسوم.</span></div>';
  }
  bindEvents();
  buildCycleStepCards();
  renderCycleStep(0, 0);
  try {
    if (localStorage.getItem(STORAGE_KEY)) showToast('تم استعادة إعدادك المحفوظ محليًا.');
  } catch {
    // Local persistence can be disabled by the browser; the design surface still works.
  }
}

init();
