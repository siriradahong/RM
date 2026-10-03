// โครงสร้างตามแผนผังสำนักสาธารณสุขและสิ่งแวดล้อมที่หน่วยงานให้มา
export const organization = [
  {
    name: "ฝ่ายบริหารงานทั่วไป",
    works: [
      "งานธุรการ",
      "งานการเงินและบัญชี",
      "งานวิชาการและแผนงาน",
      "งานบริหารทั่วไป",
    ],
  },
  {
    name: "ส่วนส่งเสริมสาธารณสุข",
    children: [
      {
        name: "ฝ่ายส่งเสริมสุขภาพ",
        works: ["งานส่งเสริมคุณภาพ", "งานสาธารณสุขชุมชน", "งานฟื้นฟูสุขภาพ"],
      },
      {
        name: "ฝ่ายป้องกันและควบคุมโรค",
        works: [
          "งานป้องกันโรคติดต่อ",
          "งานควบคุมโรคติดต่อ",
          "งานป้องกันและบำบัดยาเสพติด",
        ],
      },
      {
        name: "ฝ่ายส่งเสริมสาธารณสุข",
        works: ["งานสุขาภิบาลอาหาร", "งานสุขาภิบาลตลาดสด", "งานสัตวแพทย์"],
      },
      {
        name: "ฝ่ายควบคุมและจัดการคุณภาพสิ่งแวดล้อม",
        works: [
          "งานสุขาภิบาลสถานประกอบการ",
          "งานอนามัยสิ่งแวดล้อม",
          "งานควบคุมมลพิษและเหตุรำคาญ",
        ],
      },
      {
        name: "กลุ่มงานบริหารงานสาธารณสุข",
        kind: "group",
        works: [
          "งานบริหารกองทุนสุขภาพ",
          "งานบริหารการเงินและพัสดุ",
          "งานบริหารกองทุนดูแลระยะยาวสำหรับผู้มีภาวะพึ่งพิง",
        ],
      },
    ],
  },
  {
    name: "ส่วนบริการสาธารณสุข",
    children: [
      {
        name: "ฝ่ายบริการสิ่งแวดล้อม",
        works: ["งานเก็บขนขยะและซ่อมบำรุง", "งานพัฒนาระบบจัดการมูลฝอย"],
      },
      {
        name: "ฝ่ายส่งเสริมสิ่งแวดล้อม",
        works: [
          "งานพัฒนารายได้และการมีส่วนร่วมด้านสิ่งแวดล้อม",
          "งานพัฒนาระบบของเสียอันตรายและสิ่งปฏิกูล",
          "งานลดปริมาณขยะ",
        ],
      },
      {
        name: "ฝ่ายบริการสาธารณสุข",
        works: [
          "งานศูนย์บริการสาธารณสุขที่ 1",
          { name: "งานศูนย์บริการสาธารณสุขที่ 3", children: ["งานเภสัชกรรม"] },
          {
            name: "งานศูนย์บริการสาธารณสุขที่ 5",
            children: ["งานทันตสาธารณสุข"],
          },
          "งานกายภาพบำบัดและแพทย์ทางเลือก",
        ],
      },
    ],
  },
];

export function migrateOrganization(db) {
  db.exec(`ALTER TABLE units ADD COLUMN kind TEXT NOT NULL DEFAULT 'division' CHECK(kind IN ('section','division','group'));
    ALTER TABLE units ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 999;
    CREATE TABLE works(id INTEGER PRIMARY KEY, name TEXT NOT NULL, unit_id INTEGER NOT NULL REFERENCES units(id), parent_id INTEGER REFERENCES works(id), active INTEGER NOT NULL DEFAULT 1, UNIQUE(unit_id,name));
    ALTER TABLE activities ADD COLUMN work_id INTEGER REFERENCES works(id);
    CREATE INDEX activities_work ON activities(work_id);`);
  let order = 0;
  function addWork(work, unitId, parentId = null) {
    const item = typeof work === "string" ? { name: work } : work;
    const id = Number(
      db
        .prepare("INSERT INTO works(name,unit_id,parent_id) VALUES(?,?,?)")
        .run(item.name, unitId, parentId).lastInsertRowid,
    );
    item.children?.forEach((child) => addWork(child, unitId, id));
  }
  function addUnit(unit, parentId = null) {
    // Match names so existing accounts, scopes and reports retain their unit IDs.
    db.prepare("INSERT OR IGNORE INTO units(name) VALUES(?)").run(unit.name);
    const { id } = db
      .prepare("SELECT id FROM units WHERE name=?")
      .get(unit.name);
    db.prepare(
      "UPDATE units SET parent_id=?,kind=?,sort_order=? WHERE id=?",
    ).run(
      parentId,
      unit.children ? "section" : unit.kind || "division",
      order++,
      id,
    );
    unit.works?.forEach((work) => addWork(work, id));
    unit.children?.forEach((child) => addUnit(child, id));
  }
  organization.forEach((unit) => addUnit(unit));
  db.exec("INSERT INTO schema_migrations(version) VALUES(3)");
}
