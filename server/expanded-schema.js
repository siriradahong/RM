export function migrateExpanded(db) {
  if (
    !db.prepare("SELECT version FROM schema_migrations WHERE version=7").get()
  ) {
    db.exec(`BEGIN IMMEDIATE;
      ALTER TABLE activities ADD COLUMN duplicate_of INTEGER REFERENCES activities(id);
      CREATE TABLE report_templates(id INTEGER PRIMARY KEY,name TEXT NOT NULL,keywords TEXT NOT NULL DEFAULT '[]',unit_ids TEXT NOT NULL DEFAULT '[]',metrics TEXT NOT NULL DEFAULT '[]',active INTEGER NOT NULL DEFAULT 1,version INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE projects(id INTEGER PRIMARY KEY,name TEXT NOT NULL,unit_id INTEGER NOT NULL REFERENCES units(id),owner_id INTEGER NOT NULL REFERENCES users(id),description TEXT NOT NULL DEFAULT '',start_date TEXT,end_date TEXT,targets TEXT NOT NULL DEFAULT '[]',version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
      CREATE TABLE project_activities(activity_id INTEGER PRIMARY KEY REFERENCES activities(id),project_id INTEGER NOT NULL REFERENCES projects(id));
      CREATE TABLE report_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE report_exports(id INTEGER PRIMARY KEY,title TEXT NOT NULL,payload TEXT NOT NULL,created_by INTEGER REFERENCES users(id),schedule_key TEXT UNIQUE,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
      CREATE TABLE period_locks(id INTEGER PRIMARY KEY,unit_id INTEGER NOT NULL REFERENCES units(id),date_from TEXT NOT NULL,date_to TEXT NOT NULL,reason TEXT NOT NULL,created_by INTEGER NOT NULL REFERENCES users(id),active INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE line_link_codes(code_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL);
      CREATE TABLE extraction_runs(id INTEGER PRIMARY KEY,activity_id INTEGER NOT NULL REFERENCES activities(id),source_version INTEGER NOT NULL,engine TEXT NOT NULL,payload TEXT NOT NULL,created_by INTEGER REFERENCES users(id),created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
      CREATE TABLE file_texts(file_id INTEGER PRIMARY KEY REFERENCES files(id),text TEXT NOT NULL);
      CREATE TABLE activity_sources(activity_id INTEGER NOT NULL REFERENCES activities(id),source_activity_id INTEGER NOT NULL REFERENCES activities(id),PRIMARY KEY(activity_id,source_activity_id));
      CREATE TABLE extraction_applied(run_id INTEGER NOT NULL REFERENCES extraction_runs(id),item_index INTEGER NOT NULL,activity_id INTEGER NOT NULL REFERENCES activities(id),PRIMARY KEY(run_id,item_index));
      CREATE TABLE inbox_analysis(inbox_id INTEGER PRIMARY KEY REFERENCES inbox(id),payload TEXT NOT NULL);
      CREATE TABLE inbox_jobs(inbox_id INTEGER PRIMARY KEY REFERENCES inbox(id),state TEXT NOT NULL,error TEXT);
      CREATE TABLE line_receipts(event_id TEXT PRIMARY KEY);
      CREATE TABLE news_candidates(activity_id INTEGER PRIMARY KEY REFERENCES activities(id),source TEXT NOT NULL,result TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
      INSERT INTO schema_migrations(version) VALUES(7);
      COMMIT;`);
  }
  if (
    !db.prepare("SELECT version FROM schema_migrations WHERE version=8").get()
  ) {
    db.exec(`BEGIN IMMEDIATE;
      ALTER TABLE activities ADD COLUMN collaborators TEXT NOT NULL DEFAULT '[]';
      CREATE TABLE news_likes(news_id INTEGER NOT NULL REFERENCES news(id),user_id INTEGER NOT NULL REFERENCES users(id),PRIMARY KEY(news_id,user_id));
      CREATE TABLE news_comments(id INTEGER PRIMARY KEY,news_id INTEGER NOT NULL REFERENCES news(id),user_id INTEGER NOT NULL REFERENCES users(id),body TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
      CREATE TABLE amendment_requests(id INTEGER PRIMARY KEY,activity_id INTEGER NOT NULL REFERENCES activities(id),requested_by INTEGER NOT NULL REFERENCES users(id),reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',resolution TEXT NOT NULL DEFAULT '',resolved_by INTEGER REFERENCES users(id),created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
      CREATE UNIQUE INDEX amendment_pending ON amendment_requests(activity_id,requested_by) WHERE status='pending';
      INSERT INTO schema_migrations(version) VALUES(8);
      COMMIT;`);
  }
  if (
    !db.prepare("SELECT version FROM schema_migrations WHERE version=9").get()
  ) {
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE report_drafts(id INTEGER PRIMARY KEY,export_id INTEGER NOT NULL REFERENCES report_exports(id),owner_id INTEGER NOT NULL REFERENCES users(id),engine TEXT NOT NULL,sections TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft',version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
      INSERT INTO schema_migrations(version) VALUES(9);COMMIT;`);
  }
  const defaults = {
    fiscal_start_month: 10,
    scheduled_reports: false,
    report_periods: ["month", "quarter", "year"],
    line_reply_enabled: false,
  };
  for (const [k, v] of Object.entries(defaults))
    db.prepare(
      "INSERT OR IGNORE INTO report_settings(key,value) VALUES(?,?)",
    ).run(k, JSON.stringify(v));
  if (!db.prepare("SELECT id FROM report_templates LIMIT 1").get()) {
    const definitions = [
      [
        "ประชุมและอบรม",
        ["ประชุม", "อบรม", "อสม."],
        [],
        [
          {
            label: "ผู้เข้าร่วม",
            aliases: ["จำนวนผู้เข้าร่วม", "ผู้เข้าอบรม"],
            unit: "คน",
            aggregation: "sum",
          },
        ],
      ],
      [
        "บริการและส่งเสริมสุขภาพ",
        ["คัดกรอง", "บริการ", "วัคซีน", "เยี่ยมบ้าน"],
        [],
        [
          {
            label: "ครั้งบริการ",
            aliases: ["บริการรวม", "จำนวนครั้งบริการ"],
            unit: "ครั้งบริการ",
            aggregation: "sum",
          },
          {
            label: "ผู้เข้าร่วม",
            aliases: ["จำนวนผู้เข้าร่วม"],
            unit: "คน",
            aggregation: "sum",
          },
        ],
      ],
      [
        "ป้องกันและควบคุมโรค",
        ["ควบคุมโรค", "ไข้เลือดออก", "สำรวจ"],
        [],
        [
          {
            label: "หลังคาเรือนที่สำรวจ",
            aliases: ["จำนวนหลังคาเรือนที่สำรวจ"],
            unit: "หลังคาเรือน",
            aggregation: "sum",
          },
        ],
      ],
      [
        "เก็บขนขยะ",
        ["ขยะ", "มูลฝอย"],
        [],
        [
          {
            label: "ปริมาณขยะ",
            aliases: ["ขยะที่เก็บ", "น้ำหนักขยะ"],
            unit: "ตัน",
            aggregation: "sum",
          },
          {
            label: "จำนวนเที่ยว",
            aliases: ["เที่ยวรถ"],
            unit: "ครั้ง",
            aggregation: "sum",
          },
        ],
      ],
      [
        "ตรวจสถานประกอบการ",
        ["สถานประกอบการ", "สุขาภิบาล", "ตรวจตลาด"],
        [],
        [
          {
            label: "สถานประกอบการที่ตรวจ",
            aliases: ["จำนวนแห่งที่ตรวจ"],
            unit: "แห่ง",
            aggregation: "sum",
          },
        ],
      ],
    ];
    const insert = db.prepare(
      "INSERT INTO report_templates(name,keywords,unit_ids,metrics) VALUES(?,?,?,?)",
    );
    definitions.forEach(([name, keys, units, metrics]) =>
      insert.run(
        name,
        JSON.stringify(keys),
        JSON.stringify(units),
        JSON.stringify(metrics),
      ),
    );
  }
}
