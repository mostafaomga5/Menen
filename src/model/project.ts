export type LayoutMode = 'linear' | 'L' | 'U';
export type HeadMode = 'combined' | 'separate';
export type DimensionKey =
  | 'capOuterDiameter'
  | 'capInnerDiameter'
  | 'capHeight'
  | 'washerDiameter'
  | 'washerInnerDiameter'
  | 'washerThickness'
  | 'channelInnerWidth'
  | 'channelClearancePerSide'
  | 'channelWallHeight'
  | 'channelLength'
  | 'capPusherStroke'
  | 'washerSlideStroke'
  | 'pressStroke'
  | 'workAreaWidth'
  | 'workAreaDepth';

export interface DesignState {
  version: 1;
  layout: LayoutMode;
  headMode: HeadMode;
  measurements: Partial<Record<DimensionKey, number>>;
}

export interface DimensionDefinition {
  key: DimensionKey;
  name: string;
  symbol: string;
  partId: string;
  whatToMeasure: string;
}

export interface MachinePart {
  id: string;
  code: string;
  name: string;
  technicalName: string;
  role: string;
  status: 'known' | 'open' | 'concept';
  measureNeeds: string[];
  supplierChecks: string[];
  safetyNote?: string;
}

export const EMPTY_DESIGN: DesignState = {
  version: 1,
  layout: 'linear',
  headMode: 'combined',
  measurements: {},
};

export const DIMENSIONS: DimensionDefinition[] = [
  { key: 'capOuterDiameter', name: 'القطر الخارجي للغطاء', symbol: 'D-cap-out', partId: 'cap', whatToMeasure: 'قِس أكبر قطر من الحافة الخارجية إلى الحافة المقابلة.' },
  { key: 'capInnerDiameter', name: 'القطر الداخلي للغطاء', symbol: 'D-cap-in', partId: 'cap', whatToMeasure: 'قِس فتحة الغطاء من الداخل عند الموضع الذي يستقبل الروندلة.' },
  { key: 'capHeight', name: 'ارتفاع الغطاء', symbol: 'H-cap', partId: 'cap', whatToMeasure: 'قِس الارتفاع الكلي من أعلى الغطاء إلى قاعدته.' },
  { key: 'washerDiameter', name: 'قطر الروندلة', symbol: 'D-liner', partId: 'washer', whatToMeasure: 'قِس القطر الخارجي للروندلة من حافتها إلى الجهة المقابلة.' },
  { key: 'washerInnerDiameter', name: 'قطر فتحة الروندلة', symbol: 'D-liner-in', partId: 'washer', whatToMeasure: 'قِس قطر الفتحة المركزية للروندلة إن وجدت، من حافتها الداخلية إلى الحافة المقابلة.' },
  { key: 'washerThickness', name: 'سماكة الروندلة', symbol: 'T-liner', partId: 'washer', whatToMeasure: 'قِس السماكة في أكثر من نقطة إذا كانت المادة قابلة للانحناء.' },
  { key: 'channelInnerWidth', name: 'العرض الداخلي لمجرى U', symbol: 'W-U', partId: 'channel', whatToMeasure: 'قِس المسافة الصافية بين الجدارين الداخليين للمجرى.' },
  { key: 'channelClearancePerSide', name: 'الخلوص المختار لكل جانب', symbol: 'C-side', partId: 'channel', whatToMeasure: 'هذه قيمة تصميم تختارها أنت وليست توصية. إذا لم تدخل W-U، يحسب الموقع عرضًا تصوريًا من قطر الغطاء + ضعفي هذا الخلوص؛ اختبر الاختيار بعينات فعلية.' },
  { key: 'channelWallHeight', name: 'ارتفاع حافة مجرى U', symbol: 'H-wall', partId: 'channel', whatToMeasure: 'قِس ارتفاع الجدار الذي يمنع الغطاء من الانقلاب، ثم اختبر المرور بعينة.' },
  { key: 'channelLength', name: 'طول مجرى U', symbol: 'L-U', partId: 'channel', whatToMeasure: 'قِس المسافة بين بداية التغذية ونقطة نهاية مسار الصف.' },
  { key: 'capPusherStroke', name: 'مشوار دافع صف الأغطية', symbol: 'S-pusher', partId: 'capPusher', whatToMeasure: 'قِس الإزاحة اللازمة من موضع البداية إلى موضع التوقف الفعلي.' },
  { key: 'washerSlideStroke', name: 'مشوار لسان الروندلة', symbol: 'S-slide', partId: 'transferSlide', whatToMeasure: 'قِس المسافة بين موضع استلام الروندلة وموضع الالتقاط.' },
  { key: 'pressStroke', name: 'مشوار وحدة الكبس', symbol: 'S-press', partId: 'vacuumPressHead', whatToMeasure: 'قِس الحركة من موضع الأمان حتى ملامسة المنتج، بعد تحديد ترتيب الرأس.' },
  { key: 'workAreaWidth', name: 'عرض مساحة العمل المتاحة', symbol: 'W-space', partId: 'frame', whatToMeasure: 'قِس العرض المتاح على سطح التركيب مع ترك مساحة للصيانة.' },
  { key: 'workAreaDepth', name: 'عمق مساحة العمل المتاحة', symbol: 'D-space', partId: 'frame', whatToMeasure: 'قِس العمق المتاح وارتفاع سطح العمل.' },
];

export const PARTS: MachinePart[] = [
  {
    id: 'cap', code: 'PRODUCT-CAP', name: 'غطاء العينة', technicalName: 'Plastic cap / workpiece', role: 'قطعة العمل التي تتحرك في مجرى U؛ خامتها وأبعادها غير مثبتة في المواصفة الحالية.', status: 'open',
    measureNeeds: ['القطر الخارجي والداخلي', 'الارتفاع وعمق المقعد', 'موضع الروندلة النهائي', 'خامة الغطاء ووزنه'],
    supplierChecks: ['تفاوت أبعاد العينة بين القطع', 'شكل الشفة ومناطق التلامس', 'عدم تلف السطح أثناء الدفع والكبس'],
  },
  {
    id: 'washer', code: 'PRODUCT-LINER', name: 'روندلة العينة', technicalName: 'Liner / washer', role: 'القطعة التي تُغذّى منفردة وتُلتقط وتُثبت داخل الغطاء؛ تركيبها الطبقي واتجاهها يحتاجان تأكيدًا.', status: 'open',
    measureNeeds: ['القطر الخارجي والفتحة الداخلية إن وجدت', 'السماكة', 'الخامة والطبقات', 'الوجه الذي يلامس الغطاء', 'قابلية الانحناء أو التجعد'],
    supplierChecks: ['اختلاف السماكة بين العينات', 'توافق المادة مع الغراء', 'قابلية الالتقاط بالفاكيوم دون تشوه'],
  },
  {
    id: 'frame', code: 'M-01-F', name: 'الشاسيه وقاعدة التركيب', technicalName: 'Machine frame / mounting plate', role: 'يحمل الوحدات ويحافظ على المحاذاة والمسافات بين المحطات.', status: 'open',
    measureNeeds: ['المساحة المتاحة للآلة', 'ارتفاع سطح العمل', 'أماكن تثبيت الوحدات', 'الأحمال والاهتزاز المتوقع'],
    supplierChecks: ['نوع القطاع المعدني ومقاسه وسماكته', 'الصلابة والتعامد والاستواء', 'طريقة الوصل والحماية من التآكل'],
    safetyNote: 'لا تحدد قطاع الشاسيه أو اللحام دون حساب الأحمال والصلابة ومراجعة مختص.',
  },
  {
    id: 'capMagazine', code: 'M-01-CAP-FEED', name: 'مخزن/تغذية الأغطية', technicalName: 'Cap magazine and gravity feed', role: 'يوجّه الغطاء التالي إلى صف الأغطية؛ فتحة التغذية ومنع سقوط غطاء إضافي لم يُحسما.', status: 'open',
    measureNeeds: ['القطر الخارجي والأعظمي للغطاء', 'الارتفاع والخامة', 'اتجاه وضع الأغطية', 'عدد الأغطية وميل التغذية'],
    supplierChecks: ['الخلوص الجانبي', 'مادة الملامسة', 'منع نزول أكثر من غطاء', 'سهولة فك المخزن والتنظيف'],
  },
  {
    id: 'channel', code: 'M-01-U', name: 'مجرى الأغطية U', technicalName: 'U-channel / cap guide', role: 'يسند الأغطية في صف متلامس ويمنع انقلابها أثناء دفع الصف.', status: 'open',
    measureNeeds: ['قطر الغطاء الفعلي', 'العرض الداخلي الصافي', 'ارتفاع الجدار', 'الطول والاستقامة'],
    supplierChecks: ['الخلوص من الجانبين', 'سلاسة الحواف وخلوها من النتوءات', 'سهولة ضبط العرض', 'اختبار مرور غطاء واحد وصف كامل يدويًا'],
    safetyNote: 'أي قيمة خلوص في الموقع مقارنة هندسية أولية؛ الاختبار بعينات فعلية مطلوب.',
  },
  {
    id: 'capPusher', code: 'C1 (وظيفة مبدئية)', name: 'بستم دفع صف الأغطية', technicalName: 'Pneumatic cap pusher', role: 'يدفع صف الأغطية المتلامس على طول المجرى ببستم واحد، كما تحدد مواصفة M-01.', status: 'open',
    measureNeeds: ['مشوار الدفع المطلوب', 'قوة الدفع المقاسة', 'ضغط الهواء المتاح', 'احتكاك الصف والحمل'],
    supplierChecks: ['قطر المكبس وقطر العمود', 'قوة الامتداد والرجوع في ضغط التشغيل', 'المشوار المتاح', 'سرعة الحركة ونوع التثبيت'],
  },
  {
    id: 'glueUnit', code: 'GLUE (مفتوح)', name: 'وحدة وضع الغراء', technicalName: 'Adhesive dispensing unit', role: 'تضع الجرعة في الموضع المحدد على الغطاء؛ نوع اللاصق والجرعة وطريقة منع التنقيط غير محددة.', status: 'open',
    measureNeeds: ['خامة الغطاء والروندلة', 'موضع التطبيق', 'قطر/مساحة نقطة الغراء', 'زمن الانتظار المطلوب'],
    supplierChecks: ['توافق اللاصق مع الخامات', 'تكرارية الجرعة', 'طريقة الإغلاق والتنظيف', 'سلامة التخزين والمناولة حسب ورقة بيانات اللاصق'],
    safetyNote: 'لا يُختار لاصق ولا تُعتمد الجرعة قبل اختبار عينات ومراجعة بيانات السلامة.',
  },
  {
    id: 'washerMagazine', code: 'M-01-LINER-FEED', name: 'مخزن الروندلة', technicalName: 'Liner magazine', role: 'يخزن الروندلات ويوجهها إلى جيب واحد في اللسان السحاب.', status: 'open',
    measureNeeds: ['قطر الروندلة', 'السماكة وتغيراتها', 'الخامة والتركيب الطبقي', 'اتجاه التغذية'],
    supplierChecks: ['الخلوص الداخلي للمخزن', 'منع الالتصاق أو الانحشار', 'سعة المخزن الفعلية', 'سهولة إعادة التعبئة'],
  },
  {
    id: 'transferSlide', code: 'M-01-SLIDE', name: 'اللسان السحاب/جيب الروندلة', technicalName: 'Sliding escapement pocket', role: 'يستقبل روندلة واحدة ثم ينقلها إلى نقطة الالتقاط؛ أبعاد الجيب وآلية منع الازدواج تحتاج قياسًا واختبارًا.', status: 'open',
    measureNeeds: ['قطر وسماكة الروندلة', 'قطر/عمق الجيب', 'الخلوص بين اللسان والمجرى', 'المشوار ومحاذاة نقطة الالتقاط'],
    supplierChecks: ['اختبار عدم دخول روندلتين', 'اختبار عدم الانحشار', 'مادة اللسان ومقاومة التآكل', 'قابلية الفك والتنظيف'],
  },
  {
    id: 'vacuumPressHead', code: 'M-01-PICK/PRESS', name: 'رأس الفاكيوم والكبس', technicalName: 'Vacuum pickup and pressing head', role: 'يلتقط الروندلة وينقلها لمركز الغطاء ثم يكبسها. هل الرأس واحد أم رأس التقاط وآخر للكبس؟ قرار مفتوح.', status: 'open',
    measureNeeds: ['سطح ووزن الروندلة', 'مركز الغطاء والروندلة', 'الارتفاع والمشوار', 'قوة الكبس ومعيار التثبيت'],
    supplierChecks: ['مقاس ونوع كوب الشفط', 'التدفق والتسريب المطلوبان', 'عدم انحناء الروندلة', 'مادة وجه الكبس والمحاذاة'],
    safetyNote: 'يجب التحقق من عدم السحق أو التشوه أو سقوط الروندلة قبل الإنتاج.',
  },
  {
    id: 'pneumaticPanel', code: 'AIR / V1…', name: 'تجهيز الهواء والصمامات', technicalName: 'Air preparation and valve manifold', role: 'يرشح وينظم الهواء ويوزعه إلى المشغلات؛ قيم الضغط والتدفق وأنواع الصمامات والجهد غير محددة.', status: 'open',
    measureNeeds: ['ضغط وتدفق المصدر', 'عدد المشغلات النهائي', 'قوة وسرعة كل حركة', 'مكان عزل وتفريغ الهواء'],
    supplierChecks: ['بيانات الصمام وعدد المنافذ ووضعه الطبيعي', 'جهد وتيار الملف', 'مقاس المنافذ والتدفق', 'منظم الضغط ومقياسه وصمام العزل والتفريغ'],
    safetyNote: 'اعزل وفرّغ الضغط قبل الصيانة، وصمم حالة فقد الطاقة/الهواء بأمان.',
  },
  {
    id: 'controls', code: 'CTRL / I-O', name: 'التحكم والحساسات', technicalName: 'Controller, sensors and electrical interface', role: 'ينظم الانتقالات بعد تأكيد الموضع والفاكيوم؛ الاختيار بين Arduino وكنترول آخر لم يُحسم.', status: 'open',
    measureNeeds: ['عدد المدخلات والمخرجات', 'بيانات الحساسات', 'جهد وتيار ملفات الصمامات', 'زمن الدورة المستهدف'],
    supplierChecks: ['واجهات قيادة وعزل للأحمال الحثية', 'مصادر التغذية والحماية', 'دائرة إيقاف طارئ مستقلة', 'مهلة وخطة خطأ لكل حركة'],
    safetyNote: 'لا توصل ملفات الصمامات مباشرة بمخارج Arduino؛ دائرة الطوارئ ليست مجرد شرط برمجي.',
  },
  {
    id: 'outputZone', code: 'OUT (مفتوح)', name: 'منطقة خروج المنتج', technicalName: 'Finished-part discharge', role: 'مكان تمثيلي فقط؛ مسار إخراج الغطاء ومنع التكدس لم يحدده المشروع.', status: 'open',
    measureNeeds: ['اتجاه خروج الغطاء', 'طريقة استلام المنتج', 'المساحة المتاحة', 'معدل الإنتاج'],
    supplierChecks: ['منع التكدس', 'سهولة الوصول', 'عدم إدخال آلية جديدة بلا موافقة'],
  },
];

export const OPEN_DECISIONS = [
  'الأبعاد الكلية للشاسيه وقطاعاته وخاماته وحساب الصلابة والاهتزاز.',
  'قطر ومشوار وقوة كل بستم، وتأكيد توزيع وظائف البساتم الأربعة.',
  'نوع كل صمام وعدد المنافذ وجهد الملف ووضعه الطبيعي ومعدل التدفق.',
  'ضغط الهواء المتاح ومصدره ووحدة التجهيز والعزل والتفريغ.',
  'نوع الغراء وجرعته وطريقة التطبيق وزمن الانتظار والتنظيف.',
  'تصميم جيب اللسان والخلوص ومنع دخول روندلتين.',
  'اختيار كوب الفاكيوم ورأس واحد/رأسي التقاط وكبس منفصلين.',
  'قوة الكبس ومشواره ومعيار نجاح التثبيت.',
  'طريق إخراج المنتج ومعدل الدورة المستهدف.',
  'اختيار Arduino أو كنترول تقليدي بعد حصر الإشارات ومتطلبات التشغيل.',
];

export const DATA_TO_COLLECT = [
  'صور الغطاء من أعلى وأسفل والجانب والداخل، وصور الروندلة من الوجهين والحافة، مع مسطرة واضحة.',
  'القطر الخارجي والداخلي وارتفاع الغطاء وعمق المقعد وقطر منطقة التثبيت وخامته ووزنه.',
  'قطر الروندلة وسماكتها وخامتها وتركيبها الطبقي واتجاهها وقابليتها للانحناء.',
  'موضع الغراء النهائي وتحديد توافق اللاصق مع خامة الغطاء والروندلة.',
  'مساحة الماكينة وارتفاع سطح العمل واتجاه الدخول والخروج وطريقة استلام المنتج.',
  'ضغط الهواء ومصدره وبيانات لوحة البساتم والصمامات المتاحة.',
  'معدل الإنتاج وزمن الدورة المستهدف ومعيار قبول تثبيت الروندلة.',
  'رسومات أو ملفات CAD موثوقة للمكونات التجارية، إن كانت متوفرة.',
];

export const FAULT_GUIDE = [
  { symptom: 'الغطاء لا يتقدم أو يعلق', check: 'راجع قياس عرض مجرى U ومحاذاة صف الأغطية وفتحة التغذية، وسجّل موضع التوقف.', safe: 'أوقف الحركة واعزل الهواء قبل الوصول إلى المجرى؛ لا تدفع الصف والآلة مضغوطة.' },
  { symptom: 'غطاءان يدخلان معًا', check: 'افحص عينة التغذية وقياس الغطاء وشكل فتحة الفصل؛ تصميم آلية الفصل ما زال مفتوحًا.', safe: 'لا تضف بوابة أو بستمًا جديدًا على أنه معتمد؛ يلزم تصور واختبار منفصل.' },
  { symptom: 'الروندلة مفقودة أو مزدوجة', check: 'قِس سماكة الروندلة وقطرها وجيب اللسان، وتحقق من إشارة وجود قطعة واحدة.', safe: 'أوقف الدورة قبل إزالة قطعة أو ضبط الجيب، وامنع الوصول أثناء الحركة.' },
  { symptom: 'الفاكيوم لا يمسك الروندلة', check: 'سجّل ضغط/تدفق المصدر وتوافق سطح الروندلة والكوب والتسريب عند الوصلات.', safe: 'لا ترفع الضغط بالتخمين ولا تختبر الشفط باليد قرب رأس يتحرك.' },
  { symptom: 'الكبس لا يثبت الروندلة', check: 'قارن موضع المنتج والمشوار والضغط والحمل مع بيانات البستم ومعيار القبول.', safe: 'لا ترفع الضغط أو المشوار دون حساب الحمل والخلوص ومراجعة الحواجز.' },
  { symptom: 'الغراء لا يلتصق أو يتنقط', check: 'تحقق من توافق اللاصق مع الخامتين والجرعة وموضعها وزمن التثبيت حسب بيانات المورد.', safe: 'اتبع نشرة السلامة والتهوية والوقاية الخاصة باللاصق؛ نوعه غير محدد في المشروع.' },
  { symptom: 'المنتج يتكدس عند الخروج', check: 'سجّل موضع التكدس واتجاه الاستلام ومعدل الإنتاج؛ مسار الخروج لم يُصمم بعد.', safe: 'لا تضف دافع إخراج آليًا أو تمد يدك إلى منطقة حركة قبل تقييم الخطر.' },
];

export function normalizeDesign(input: unknown): DesignState | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Partial<DesignState>;
  if (raw.version !== 1 || !raw.measurements || typeof raw.measurements !== 'object') return null;
  const measurements: DesignState['measurements'] = {};
  for (const field of DIMENSIONS) {
    const value = raw.measurements[field.key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 10_000_000) measurements[field.key] = value;
  }
  const layout: LayoutMode = raw.layout === 'L' || raw.layout === 'U' ? raw.layout : 'linear';
  const headMode: HeadMode = raw.headMode === 'separate' ? 'separate' : 'combined';
  return { version: 1, layout, headMode, measurements };
}

export function filledDimensionCount(state: DesignState): number {
  return Object.keys(state.measurements).length;
}

export function calculateChannelFit(state: DesignState): { label: string; kind: 'unknown' | 'good' | 'warning' } {
  const cap = state.measurements.capOuterDiameter;
  const capInner = state.measurements.capInnerDiameter;
  const liner = state.measurements.washerDiameter;
  const linerInner = state.measurements.washerInnerDiameter;
  const width = state.measurements.channelInnerWidth;
  const clearanceChoice = state.measurements.channelClearancePerSide;
  if (cap && capInner && capInner >= cap) return { label: 'القطر الداخلي المسجل يجب أن يكون أصغر من القطر الخارجي للغطاء؛ راجع القياس قبل الاعتماد.', kind: 'warning' };
  if (liner && linerInner && linerInner >= liner) return { label: 'فتحة الروندلة المدخلة تساوي أو تتجاوز قطرها الخارجي؛ راجع قياسات الحافتين.', kind: 'warning' };
  if (capInner && liner && liner > capInner) return { label: 'قطر الروندلة أكبر من فتحة الغطاء الداخلية المدخلة؛ راجع اتجاه القياس وشكل المقعد.', kind: 'warning' };
  if (cap && !width && clearanceChoice) return { label: `عرض تصوري مشتق = قطر الغطاء ${cap} + ضعفي الخلوص الذي اخترته ${clearanceChoice} مم؛ إذا أدخلت W-U فسيكون هو المعتمد في المجسم. يلزم اختبار فعلي.`, kind: 'unknown' };
  if (!cap || !width) return { label: 'أدخل قطر الغطاء وعرض المجرى أو اختر خلوصًا لكل جانب؛ لا توجد قيمة خلوص موصى بها دون تجربة.', kind: 'unknown' };
  const perSide = (width - cap) / 2;
  if (perSide < 0) return { label: `العرض المسجل أقل من قطر الغطاء بمقدار ${Math.abs(width - cap).toFixed(2)} مم إجمالًا؛ راجع القياسات، فهذا فحص هندسي مبسط فقط.`, kind: 'warning' };
  if (clearanceChoice && Math.abs(perSide - clearanceChoice) > 0.05) return { label: `W-U المدخل يعادل ${perSide.toFixed(2)} مم لكل جانب، وهو مختلف عن اختيارك ${clearanceChoice} مم؛ W-U له الأولوية في المجسم. تحقق بعينة فعلية.`, kind: 'warning' };
  return { label: `فرق العرض الكلي ${((width - cap)).toFixed(2)} مم (نظريًا ${perSide.toFixed(2)} مم لكل جانب إذا تمركز الغطاء). ليست توصية خلوص ولا اعتمادًا للتشغيل.`, kind: perSide === 0 ? 'warning' : 'good' };
}
