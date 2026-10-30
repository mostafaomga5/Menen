const box = (x: number, y: number, w: number, h: number, title: string, sub: string, accent = '#49b4e7') => `
  <g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="#132435" stroke="#33536b" stroke-width="2"/>
    <rect x="${x}" y="${y}" width="6" height="${h}" rx="3" fill="${accent}"/>
    <text x="${x + w / 2}" y="${y + 32}" class="title" text-anchor="middle">${title}</text>
    <text x="${x + w / 2}" y="${y + 58}" class="sub" text-anchor="middle">${sub}</text>
  </g>`;

const arrow = (x1: number, y: number, x2: number, color = '#43b4ea') => `<path d="M${x1} ${y} H${x2}" fill="none" stroke="${color}" stroke-width="3" marker-end="url(#arrowHead)"/>`;

export function pneumaticDiagram(): string {
  return `<svg viewBox="0 0 1100 280" role="img" aria-label="مخطط وظيفي مفاهيمي لمسار الهواء والصمامات والمشغلات" xmlns="http://www.w3.org/2000/svg">
  <defs><marker id="arrowHead" markerWidth="9" markerHeight="9" refX="6" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8z" fill="#43b4ea"/></marker><style>
  .title{font:700 16px Tahoma,Arial,sans-serif;fill:#e5f0f7}.sub{font:12px Tahoma,Arial,sans-serif;fill:#9fb5c5}.tiny{font:11px Tahoma,Arial,sans-serif;fill:#f0d28c}.note{font:10px Tahoma,Arial,sans-serif;fill:#8299ab}
  </style></defs>
  <rect x="8" y="12" width="1084" height="245" rx="14" fill="#0b1621" stroke="#22384b"/>
  ${box(900,75,150,80,'مصدر الهواء','ضغط/تدفق: غير محدد','#f1c364')}
  ${box(680,75,165,80,'عزل + تجهيز','منظم / مقياس / تفريغ','#e7b657')}
  ${box(450,75,175,80,'مجموعة الصمامات','النوع والعدد والجهد مفتوحة','#4bb8e9')}
  ${box(220,48,170,74,'مشغلات الحركة','دفع · لسان · حركة · كبس','#4bb8e9')}
  ${box(220,143,170,70,'دائرة الفاكيوم','مولّد / صمام / كوب؟','#85c9ed')}
  ${arrow(900,115,850)}${arrow(680,115,630)}${arrow(450,98,395)}${arrow(450,133,395)}
  <path d="M305 123 V140" stroke="#43b4ea" stroke-width="2" stroke-dasharray="5 5"/>
  <text x="532" y="190" class="tiny" text-anchor="middle">خط متقطع = ترتيب وظيفي فقط؛ لا يحدد التوصيلات أو عدد الصمامات</text>
  <text x="962" y="188" class="note" text-anchor="middle">إيقاف وعزل وتفريغ آمن قبل الصيانة</text>
  <text x="306" y="235" class="note" text-anchor="middle">المشغلات الفعلية وعددها وتوزيعها تحتاج اعتمادًا</text>
  </svg>`;
}

export function controlDiagram(): string {
  return `<svg viewBox="0 0 1100 280" role="img" aria-label="مخطط إشارات وظيفي مقترح للتحكم والحساسات" xmlns="http://www.w3.org/2000/svg">
  <defs><marker id="ctrlArrow" markerWidth="9" markerHeight="9" refX="6" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8z" fill="#f1c364"/></marker><style>
  .title{font:700 16px Tahoma,Arial,sans-serif;fill:#e5f0f7}.sub{font:12px Tahoma,Arial,sans-serif;fill:#9fb5c5}.tiny{font:11px Tahoma,Arial,sans-serif;fill:#f0d28c}.note{font:10px Tahoma,Arial,sans-serif;fill:#8299ab}
  </style></defs>
  <rect x="8" y="12" width="1084" height="245" rx="14" fill="#0b1621" stroke="#22384b"/>
  ${box(895,55,155,75,'طلب المشغّل','START / STOP','#e5b84e')}
  ${box(895,150,155,68,'إيقاف طوارئ','دائرة مستقلة','#ed826f')}
  ${box(650,80,175,90,'منطق التحكم','تسلسل + مهلة + خطأ','#e5b84e')}
  ${box(420,50,170,70,'واجهات قيادة','عزل وحماية الملفات','#49b4e7')}
  ${box(420,145,170,70,'إشارات رجوع','موضع / VAC_OK','#9bcae3')}
  ${box(195,50,170,70,'الصمامات','V1…V5 أسماء وظيفية','#49b4e7')}
  ${box(195,145,170,70,'الحساسات','النوع والمكان مفتوحان','#9bcae3')}
  ${arrow(895,92,830,'#f1c364')}${arrow(650,105,595,'#f1c364')}${arrow(420,85,370,'#f1c364')}
  <path d="M280 121 V145" stroke="#9bcae3" stroke-width="2" stroke-dasharray="5 5"/>
  <path d="M195 180 H115 V125 H650" fill="none" stroke="#8abbd7" stroke-width="2" stroke-dasharray="7 6" marker-end="url(#ctrlArrow)"/>
  <path d="M895 184 H855 V213 H835" fill="none" stroke="#ed826f" stroke-width="2" stroke-dasharray="6 5"/>
  <text x="730" y="225" class="tiny" text-anchor="middle">تحقق من الحساس قبل الانتقال؛ لا تعتمد على المؤقت وحده</text>
  <text x="963" y="242" class="note" text-anchor="middle">أرقام الأطراف والجهد لا تُحدد إلا بعد اختيار الأجهزة</text>
  </svg>`;
}
