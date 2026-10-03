// Fictional scenarios only. Nothing in this module reads or changes the database.
// A seeder resolves unitName/workName/categoryName to the installation's existing IDs.
const definitions = [
  {
    key: "administration",
    unitName: "ฝ่ายบริหารงานทั่วไป",
    workName: "งานธุรการ",
    categoryName: "ประชุมและอบรม",
    area: "ห้องประชุมตัวอย่าง ก",
    workers: "เจ้าหน้าที่ธุรการสาธิต 2 คน และผู้ประสานงานสาธิต 1 คน",
    titles: [
      "ประชุมติดตามเอกสารและแผนงานประจำเดือน",
      "อบรมการจัดเก็บหลักฐานงานในระบบ",
    ],
    results: [
      "จัดประชุมทบทวนรายการเอกสารและมอบหมายผู้ติดตามครบทุกหัวข้อ ผู้เข้าร่วมฝึกค้นหาเอกสารและเชื่อมหลักฐานกับรายการงาน",
      "ผู้เข้าร่วมทดลองตั้งชื่อเรื่อง อัปโหลดหลักฐาน และค้นหารายการย้อนหลัง โดยรวบรวมข้อเสนอแนะสำหรับการใช้งานครั้งถัดไป",
    ],
    metrics: [
      [
        { label: "ผู้เข้าร่วมประชุม", value: 18, unit: "คน" },
        { label: "การประชุม", value: 1, unit: "ครั้ง" },
      ],
      [
        { label: "ผู้เข้าร่วมอบรม", value: 15, unit: "คน" },
        { label: "การอบรม", value: 1, unit: "กิจกรรม" },
      ],
    ],
  },
  {
    key: "health-promotion",
    unitName: "ฝ่ายส่งเสริมสุขภาพ",
    workName: "งานสาธารณสุขชุมชน",
    categoryName: "กิจกรรมส่งเสริมสุขภาพ",
    area: "ศูนย์กิจกรรมชุมชนสาธิต A",
    workers: "ทีมส่งเสริมสุขภาพสาธิต 3 คน และอาสาสมัครสาธิต 15 คน",
    titles: [
      "กิจกรรมขยับกายและเรียนรู้การดูแลสุขภาพ",
      "เวิร์กช็อปอาหารสมดุลสำหรับครอบครัวตัวอย่าง",
    ],
    results: [
      "จัดฐานเรียนรู้เรื่องการเคลื่อนไหวในชีวิตประจำวันและฝึกบันทึกการเข้าร่วมกิจกรรม ผู้เข้าร่วมรับสื่อความรู้ตัวอย่างครบทุกคน",
      "จัดกิจกรรมเรียนรู้การอ่านฉลากอาหารและวางแผนเมนูตัวอย่าง พร้อมเก็บแบบประเมินกิจกรรมสำหรับสาธิตการสรุปผล",
    ],
    metrics: [
      [
        { label: "ผู้เข้าร่วมกิจกรรม", value: 120, unit: "คน" },
        { label: "อาสาสมัคร", value: 15, unit: "คน" },
        { label: "จุดจัดกิจกรรม", value: 3, unit: "แห่ง" },
      ],
      [
        { label: "ผู้เข้าร่วมกิจกรรม", value: 42, unit: "คน" },
        { label: "ครัวเรือนที่เข้าร่วม", value: 21, unit: "หลังคาเรือน" },
      ],
    ],
  },
  {
    key: "disease-prevention",
    unitName: "ฝ่ายป้องกันและควบคุมโรค",
    workName: "งานป้องกันโรคติดต่อ",
    categoryName: "ป้องกันและควบคุมโรค",
    area: "ชุมชนตัวอย่าง ข",
    workers: "เจ้าหน้าที่ป้องกันโรคสาธิต 2 คน และอาสาสมัครสาธิต 5 คน",
    titles: [
      "สำรวจสภาพแวดล้อมและให้ความรู้การป้องกันโรค",
      "รณรงค์ดูแลภาชนะน้ำในชุมชนตัวอย่าง",
    ],
    results: [
      "ทีมสาธิตเดินสำรวจพื้นที่ตัวอย่างและมอบสื่อความรู้เรื่องการดูแลสิ่งแวดล้อม พร้อมบันทึกจำนวนครัวเรือนที่เข้าร่วมเพื่อใช้แสดงผลบนแดชบอร์ด",
      "จัดกิจกรรมร่วมกับครัวเรือนตัวอย่างเพื่อทบทวนจุดที่ควรดูแลและนัดหมายติดตาม ไม่ใช่รายงานการระบาดหรือข้อมูลผู้ป่วยจริง",
    ],
    metrics: [
      [
        { label: "ครัวเรือนที่เข้าร่วมสำรวจ", value: 80, unit: "หลังคาเรือน" },
        { label: "จุดสำรวจ", value: 12, unit: "แห่ง" },
      ],
      [
        { label: "ครัวเรือนที่เข้าร่วมรณรงค์", value: 28, unit: "หลังคาเรือน" },
        { label: "ผู้เข้าร่วม", value: 40, unit: "คน" },
      ],
    ],
  },
  {
    key: "food-sanitation",
    unitName: "ฝ่ายส่งเสริมสาธารณสุข",
    workName: "งานสุขาภิบาลอาหาร",
    categoryName: "ประชุมและอบรม",
    area: "ตลาดชุมชนสาธิต B",
    workers:
      "เจ้าหน้าที่สุขาภิบาลอาหารสาธิต 2 คน และผู้ประสานงานตลาดสาธิต 1 คน",
    titles: [
      "ให้ความรู้สุขาภิบาลอาหารแก่ผู้ประกอบการตัวอย่าง",
      "ติดตามการจัดพื้นที่เตรียมอาหารของร้านตัวอย่าง",
    ],
    results: [
      "สาธิตการประเมินพื้นที่เตรียมอาหารและจัดฐานเรียนรู้การแยกอุปกรณ์ ผู้เข้าร่วมร่วมทำแบบฝึกหัดครบทุกฐาน โดยไม่มีการรับรองร้านค้าจริง",
      "ติดตามร้านตัวอย่างตามแผนและรวบรวมข้อเสนอแนะเรื่องพื้นที่เตรียมอาหาร เพื่อสาธิตการเปรียบเทียบผลงานระหว่างเดือน",
    ],
    metrics: [
      [
        { label: "ผู้เข้าร่วมอบรม", value: 24, unit: "คน" },
        { label: "จุดสาธิตสุขาภิบาลอาหาร", value: 12, unit: "แห่ง" },
      ],
      [
        { label: "ร้านตัวอย่างที่ติดตาม", value: 9, unit: "แห่ง" },
        { label: "การลงพื้นที่", value: 2, unit: "ครั้ง" },
      ],
    ],
  },
  {
    key: "environmental-quality",
    unitName: "ฝ่ายควบคุมและจัดการคุณภาพสิ่งแวดล้อม",
    workName: "งานอนามัยสิ่งแวดล้อม",
    categoryName: "บริการสิ่งแวดล้อม",
    area: "ศูนย์ชุมชนตัวอย่าง ง",
    workers: "เจ้าหน้าที่อนามัยสิ่งแวดล้อมสาธิต 3 คน",
    titles: [
      "สำรวจความสะอาดพื้นที่สาธารณะตัวอย่าง",
      "ติดตามแผนดูแลสิ่งแวดล้อมของศูนย์ชุมชนตัวอย่าง",
    ],
    results: [
      "สำรวจจุดบริการสาธารณะตัวอย่างและจัดทำรายการข้อเสนอแนะด้านความสะอาด พร้อมแนบหลักฐานสำหรับฝึกตรวจข้อมูลก่อนสรุป",
      "ทบทวนรายการปรับปรุงพื้นที่ตัวอย่างและจัดลำดับการติดตาม รอบนี้ใช้แสดงการเชื่อมข้อมูลฝ่าย งาน และประเภทงานที่แตกต่างกัน",
    ],
    metrics: [
      [
        { label: "พื้นที่ตัวอย่างที่สำรวจ", value: 6, unit: "แห่ง" },
        { label: "การติดตาม", value: 2, unit: "ครั้ง" },
      ],
      [
        { label: "ศูนย์ชุมชนตัวอย่างที่ติดตาม", value: 4, unit: "แห่ง" },
        { label: "กิจกรรมปรับปรุงพื้นที่", value: 1, unit: "กิจกรรม" },
      ],
    ],
  },
  {
    key: "health-fund",
    unitName: "กลุ่มงานบริหารงานสาธารณสุข",
    workName: "งานบริหารกองทุนสุขภาพ",
    categoryName: "ประชุมและอบรม",
    area: "ห้องประสานงานตัวอย่าง จ",
    workers: "เจ้าหน้าที่กองทุนสาธิต 2 คน และคณะทำงานสาธิต 6 คน",
    titles: [
      "ประชุมทบทวนเอกสารโครงการสุขภาพตัวอย่าง",
      "รวบรวมเอกสารประกอบโครงการตัวอย่างรอตรวจ",
    ],
    results: [
      "คณะทำงานสาธิตร่วมตรวจความครบถ้วนของเอกสารโครงการตัวอย่างและจัดทำรายการติดตาม ไม่มีการอนุมัติหรือเบิกจ่ายเงินจริง",
      "รอตรวจเอกสารแนบและยืนยันผลการประชุมก่อนเปลี่ยนสถานะเป็นพร้อมสรุป ใช้สาธิตงานที่ค้างจากเดือนก่อน",
    ],
    metrics: [
      [
        { label: "ผู้เข้าร่วมประชุม", value: 8, unit: "คน" },
        { label: "การประชุม", value: 1, unit: "ครั้ง" },
      ],
      [],
    ],
  },
  {
    key: "waste-service",
    unitName: "ฝ่ายบริการสิ่งแวดล้อม",
    workName: "งานเก็บขนขยะและซ่อมบำรุง",
    categoryName: "บริการสิ่งแวดล้อม",
    area: "เส้นทางเก็บขนตัวอย่าง ฉ",
    workers: "ทีมเก็บขนสาธิต 4 คน และช่างซ่อมบำรุงสาธิต 1 คน",
    titles: [
      "เก็บขนมูลฝอยตามเส้นทางตัวอย่าง",
      "ตรวจความพร้อมอุปกรณ์เก็บขนรอบติดตาม",
    ],
    results: [
      "บันทึกรอบเก็บขนและน้ำหนักมูลฝอยสมมติตามเส้นทางตัวอย่าง พร้อมตรวจอุปกรณ์หลังปฏิบัติงาน ตัวเลขใช้ทดสอบการรวมหน่วยตันบนแดชบอร์ด",
      "รอตรวจหลักฐานรายการอุปกรณ์และยืนยันจำนวนรอบบริการก่อนสรุปผล",
    ],
    metrics: [
      [
        { label: "มูลฝอยสมมติที่เก็บขน", value: 2.4, unit: "ตัน" },
        { label: "รอบบริการ", value: 3, unit: "ครั้งบริการ" },
      ],
      [{ label: "รอบตรวจอุปกรณ์เบื้องต้น", value: 1, unit: "ครั้ง" }],
    ],
  },
  {
    key: "waste-reduction",
    unitName: "ฝ่ายส่งเสริมสิ่งแวดล้อม",
    workName: "งานลดปริมาณขยะ",
    categoryName: "บริการสิ่งแวดล้อม",
    area: "จุดเรียนรู้ชุมชนตัวอย่าง ช",
    workers: "เจ้าหน้าที่ส่งเสริมสิ่งแวดล้อมสาธิต 2 คน และแกนนำชุมชนสาธิต 3 คน",
    titles: [
      "กิจกรรมคัดแยกวัสดุและลดขยะในครัวเรือนตัวอย่าง",
      "ติดตามบันทึกการคัดแยกวัสดุของครัวเรือนตัวอย่าง",
    ],
    results: [
      "จัดกิจกรรมเรียนรู้การคัดแยกและชั่งวัสดุสมมติ ผู้เข้าร่วมฝึกบันทึกผลรายครัวเรือนเพื่อนำมาแสดงการสรุปหน่วยกิโลกรัม",
      "รอรวบรวมแบบบันทึกจากครัวเรือนตัวอย่างให้ครบก่อนตรวจทานยอดรวม",
    ],
    metrics: [
      [
        { label: "วัสดุสมมติที่คัดแยก", value: 240, unit: "กิโลกรัม" },
        { label: "ผู้เข้าร่วมกิจกรรม", value: 75, unit: "คน" },
        { label: "ครัวเรือนที่เข้าร่วม", value: 30, unit: "หลังคาเรือน" },
      ],
      [],
    ],
  },
  {
    key: "health-service",
    unitName: "ฝ่ายบริการสาธารณสุข",
    workName: "งานศูนย์บริการสาธารณสุขที่ 1",
    categoryName: "เยี่ยมบ้าน",
    area: "พื้นที่เยี่ยมบ้านชุมชนตัวอย่าง ซ",
    workers: "ทีมบริการสุขภาพสาธิต 3 คน และอาสาสมัครสาธิต 2 คน",
    titles: [
      "เยี่ยมบ้านและให้ความรู้ครอบครัวตัวอย่าง",
      "ติดตามสรุปกิจกรรมเยี่ยมบ้านรอบถัดไป",
    ],
    results: [
      "ทีมสาธิตฝึกบันทึกการเยี่ยมบ้านและการมอบสื่อดูแลสุขภาพ ใช้เฉพาะจำนวนรวม ไม่มีชื่อ ที่อยู่ หรือข้อมูลสุขภาพของบุคคลจริง",
      "รอตรวจจำนวนครั้งบริการและหลักฐานจากทีมสาธิตก่อนเผยแพร่ผลรวม",
    ],
    metrics: [
      [
        { label: "ครัวเรือนตัวอย่างที่เยี่ยม", value: 12, unit: "หลังคาเรือน" },
        { label: "การเยี่ยมบ้าน", value: 12, unit: "ครั้งบริการ" },
        { label: "ผู้ร่วมกิจกรรมตัวอย่าง", value: 20, unit: "คน" },
      ],
      [{ label: "ครัวเรือนที่บันทึกเบื้องต้น", value: 4, unit: "หลังคาเรือน" }],
    ],
  },
];

/** One fixed department/work assignment for each fictional employee account. */
export const demoUnitAccounts = definitions.map((definition, index) => ({
  key: definition.key,
  unitName: definition.unitName,
  workName: definition.workName,
  displayName: `[สาธิต] เจ้าหน้าที่ ${String(index + 1).padStart(2, "0")}`,
}));

function calendar(today) {
  const parsed = new Date(`${today}T12:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(today) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== today
  )
    throw new Error("วันที่สำหรับข้อมูลสาธิตไม่ถูกต้อง");
  const year = parsed.getUTCFullYear();
  const month = parsed.getUTCMonth();
  const day = parsed.getUTCDate();
  const format = (date) => date.toISOString().slice(0, 10);
  return {
    current: (index) =>
      format(new Date(Date.UTC(year, month, Math.max(1, day - (index % 5))))),
    previous: (index) =>
      format(new Date(Date.UTC(year, month - 1, 6 + index * 3))),
  };
}

/** 18 reports: current month 9 ready + 3 pending; prior month 5 ready + 1 pending. */
export function buildDemoScenarios(todayYYYYMMDD) {
  const dates = calendar(todayYYYYMMDD);
  return definitions.flatMap((definition, index) =>
    [0, 1].map((round) => ({
      key: `${definition.key}-${round + 1}`,
      unitName: definition.unitName,
      workName: definition.workName,
      title: `[สาธิต] ${definition.titles[round]}`,
      date:
        round === 1 && index < 6
          ? dates.previous(index)
          : dates.current(index + round),
      categoryName: definition.categoryName,
      area: definition.area,
      workers: definition.workers,
      result: `ข้อมูลสมมติสำหรับสาธิตระบบ ไม่ใช่ผลการปฏิบัติงานจริง: ${definition.results[round]}`,
      metrics: definition.metrics[round].map((metric) => ({ ...metric })),
      status: round === 1 && index >= 5 ? "pending" : "ready",
    })),
  );
}

/** Internal feed examples only; publication here never means sending to an external service. */
export function buildDemoNews(reports) {
  const keys = [
    "health-promotion-1",
    "disease-prevention-1",
    "waste-reduction-1",
    "health-service-1",
    "food-sanitation-1",
    "administration-1",
  ];
  return keys.map((activityKey, index) => {
    const report = reports.find((item) => item.key === activityKey);
    if (!report || report.status !== "ready")
      throw new Error(`ไม่พบรายงานพร้อมสรุปสำหรับข่าวสาธิต: ${activityKey}`);
    return {
      key: `news-${activityKey}`,
      activityKey,
      title: report.title,
      body: `ข่าวสาธิต — ข้อมูลและตัวเลขทั้งหมดเป็นข้อมูลสมมติ ใช้เพื่อทดลองฟีดข่าวภายในเท่านั้น\n\n${report.unitName} / ${report.workName}\nวันที่กิจกรรมตัวอย่าง ${report.date}\nพื้นที่: ${report.area}\n\n${report.result}\n\nผลรวมตัวอย่าง: ${report.metrics.map((metric) => `${metric.label} ${metric.value} ${metric.unit}`).join("; ")}\n\nไม่มีการดำเนินกิจกรรมหรือเผยแพร่ข่าวจริงจากข้อมูลชุดนี้`,
      status: index < 4 ? "published" : "draft",
    };
  });
}

/** 3 unlinked and 2 linked messages simulating LINE input, without calling LINE. */
export function buildDemoInbox(reports) {
  const samples = [
    {
      key: "inbox-unlinked-health",
      reportKey: "health-promotion-1",
      linked: false,
      text: "รับไฟล์สรุปกิจกรรมตัวอย่างแล้ว รอเจ้าหน้าที่สร้างรายการและตรวจยอดผู้เข้าร่วม",
    },
    {
      key: "inbox-unlinked-waste",
      reportKey: "waste-service-2",
      linked: false,
      text: "ทีมสาธิตส่งบันทึกตรวจอุปกรณ์เบื้องต้น รอเชื่อมกับรายการงานที่เกี่ยวข้อง",
    },
    {
      key: "inbox-unlinked-fund",
      reportKey: "health-fund-2",
      linked: false,
      text: "มีเอกสารโครงการสมมติที่ยังรอตรวจ ขอให้ผู้รับผิดชอบทบทวนก่อนสรุป",
    },
    {
      key: "inbox-linked-disease",
      reportKey: "disease-prevention-1",
      linked: true,
      text: "สรุปตัวอย่าง: ครัวเรือนที่เข้าร่วมสำรวจ 80 หลังคาเรือน จุดสำรวจ 12 แห่ง พร้อมเชื่อมกับรายงาน",
    },
    {
      key: "inbox-linked-service",
      reportKey: "health-service-1",
      linked: true,
      text: "สรุปตัวอย่าง: เยี่ยมบ้าน 12 ครัวเรือน 12 ครั้งบริการ ผู้ร่วมกิจกรรม 20 คน ไม่มีข้อมูลบุคคลจริง",
    },
  ];
  return samples.map((sample, index) => {
    const report = reports.find((item) => item.key === sample.reportKey);
    if (!report)
      throw new Error(`ไม่พบรายงานประกอบข้อความสาธิต: ${sample.reportKey}`);
    return {
      key: sample.key,
      activityKey: sample.linked ? sample.reportKey : null,
      unitName: report.unitName,
      senderName: `ผู้รายงานสาธิต ${index + 1}`,
      reportedAt: `${report.date}T09:${String(index * 10).padStart(2, "0")}:00+07:00`,
      text: `[สาธิต — จำลองข้อความ LINE ภายในระบบ ไม่ได้ส่งผ่าน LINE จริง] ${sample.text}`,
    };
  });
}
