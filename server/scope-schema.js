export function migrateScope(db) {
  if (!db.prepare("SELECT 1 FROM schema_migrations WHERE version=11").get())
    db.exec(`BEGIN IMMEDIATE;
    ALTER TABLE users ADD COLUMN work_scopes TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE users ADD COLUMN personnel_type TEXT NOT NULL DEFAULT '';
    ALTER TABLE users ADD COLUMN position TEXT NOT NULL DEFAULT '';
    ALTER TABLE users ADD COLUMN avatar_url TEXT;
    ALTER TABLE activities ADD COLUMN owner_confirmed_at TEXT;
    ALTER TABLE activities ADD COLUMN source_purged_at TEXT;
    ALTER TABLE activities ADD COLUMN unit_label TEXT;
    ALTER TABLE activities ADD COLUMN work_label TEXT;
    UPDATE activities SET unit_label=(SELECT name FROM units WHERE id=activities.unit_id),work_label=(SELECT name FROM works WHERE id=activities.work_id);
    CREATE TRIGGER activity_org_on_insert AFTER INSERT ON activities BEGIN UPDATE activities SET unit_label=(SELECT name FROM units WHERE id=NEW.unit_id),work_label=(SELECT name FROM works WHERE id=NEW.work_id) WHERE id=NEW.id; END;
    CREATE TRIGGER activity_org_on_move AFTER UPDATE OF unit_id,work_id ON activities WHEN NEW.unit_id IS NOT OLD.unit_id OR NEW.work_id IS NOT OLD.work_id BEGIN UPDATE activities SET unit_label=(SELECT name FROM units WHERE id=NEW.unit_id),work_label=(SELECT name FROM works WHERE id=NEW.work_id) WHERE id=NEW.id; END;
    CREATE TABLE organization_history(id INTEGER PRIMARY KEY,entity TEXT NOT NULL,entity_id INTEGER NOT NULL,payload TEXT NOT NULL,effective_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),recorded_by INTEGER REFERENCES users(id));
    INSERT INTO organization_history(entity,entity_id,payload) SELECT 'units',id,json_object('name',name,'parent_id',parent_id,'kind',kind,'active',active) FROM units;
    INSERT INTO organization_history(entity,entity_id,payload) SELECT 'works',id,json_object('name',name,'parent_id',parent_id,'unit_id',unit_id,'active',active) FROM works;
    ALTER TABLE activities ADD COLUMN news_requested INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE activities ADD COLUMN brief INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE activities ADD COLUMN community_id INTEGER;
    CREATE TABLE news_candidates(activity_id INTEGER PRIMARY KEY REFERENCES activities(id),requested_by INTEGER NOT NULL REFERENCES users(id),state TEXT NOT NULL DEFAULT 'requested' CHECK(state IN ('requested','in_review','dismissed','published')),note TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE activity_people(activity_id INTEGER NOT NULL REFERENCES activities(id),user_id INTEGER NOT NULL REFERENCES users(id),work_role TEXT NOT NULL,confirmed_at TEXT,PRIMARY KEY(activity_id,user_id));
    CREATE TABLE activity_units(activity_id INTEGER NOT NULL REFERENCES activities(id),unit_id INTEGER NOT NULL REFERENCES units(id),PRIMARY KEY(activity_id,unit_id));
    CREATE TABLE personnel_history(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),unit_id INTEGER REFERENCES units(id),work_id INTEGER REFERENCES works(id),roles TEXT NOT NULL,effective_at TEXT NOT NULL,recorded_by INTEGER REFERENCES users(id));
    INSERT INTO personnel_history(user_id,unit_id,work_id,roles,effective_at) SELECT id,unit_id,work_id,roles,created_at FROM users;
    CREATE TABLE delegation_grants(id INTEGER PRIMARY KEY,grantor_id INTEGER NOT NULL REFERENCES users(id),grantee_id INTEGER NOT NULL REFERENCES users(id),unit_id INTEGER REFERENCES units(id),work_id INTEGER REFERENCES works(id),starts_at TEXT NOT NULL,ends_at TEXT NOT NULL,reason TEXT NOT NULL,revoked INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE period_locks(id INTEGER PRIMARY KEY,unit_id INTEGER NOT NULL REFERENCES units(id),date_from TEXT NOT NULL,date_to TEXT NOT NULL,reason TEXT NOT NULL,created_by INTEGER NOT NULL REFERENCES users(id),active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE amendment_requests(id INTEGER PRIMARY KEY,activity_id INTEGER NOT NULL REFERENCES activities(id),requested_by INTEGER NOT NULL REFERENCES users(id),reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),resolution TEXT NOT NULL DEFAULT '',resolved_by INTEGER REFERENCES users(id),resolved_at TEXT,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE UNIQUE INDEX amendment_pending_scope ON amendment_requests(activity_id,requested_by) WHERE status='pending';
    CREATE TABLE amendment_grants(activity_id INTEGER NOT NULL REFERENCES activities(id),user_id INTEGER NOT NULL REFERENCES users(id),expires_at TEXT NOT NULL,PRIMARY KEY(activity_id,user_id));
    CREATE TABLE scope_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE personal_preferences(user_id INTEGER PRIMARY KEY REFERENCES users(id),reminder_time TEXT NOT NULL DEFAULT '09:00',channel TEXT NOT NULL DEFAULT 'web' CHECK(channel IN ('web','line')));
    CREATE TABLE notifications(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),kind TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL DEFAULT '',route TEXT NOT NULL DEFAULT '',dedupe_key TEXT NOT NULL UNIQUE,read_at TEXT,delivery_state TEXT NOT NULL DEFAULT 'web',created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE scheduled_summaries(id INTEGER PRIMARY KEY,schedule_key TEXT NOT NULL UNIQUE,user_id INTEGER NOT NULL REFERENCES users(id),payload TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE task_extensions(id INTEGER PRIMARY KEY,task_id INTEGER NOT NULL REFERENCES project_tasks(id),requested_by INTEGER NOT NULL REFERENCES users(id),requested_date TEXT NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',resolved_by INTEGER REFERENCES users(id));
    ALTER TABLE project_tasks ADD COLUMN last_update_at TEXT;
    ALTER TABLE projects ADD COLUMN plan_id INTEGER;
    ALTER TABLE projects ADD COLUMN completed_at TEXT;
    ALTER TABLE projects ADD COLUMN work_id INTEGER REFERENCES works(id);
    CREATE TABLE plans(id INTEGER PRIMARY KEY,title TEXT NOT NULL,fiscal_year INTEGER NOT NULL,unit_id INTEGER NOT NULL REFERENCES units(id),approved_budget REAL NOT NULL DEFAULT 0,reference TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE project_expenses(id INTEGER PRIMARY KEY,project_id INTEGER NOT NULL REFERENCES projects(id),amount REAL NOT NULL CHECK(amount>=0),date TEXT NOT NULL,description TEXT NOT NULL,reference TEXT NOT NULL,created_by INTEGER NOT NULL REFERENCES users(id));
    CREATE TABLE communities(id INTEGER PRIMARY KEY,name TEXT NOT NULL UNIQUE,district INTEGER NOT NULL CHECK(district BETWEEN 1 AND 4),latitude REAL,longitude REAL,active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE community_targets(unit_id INTEGER NOT NULL REFERENCES units(id),community_id INTEGER NOT NULL REFERENCES communities(id),fiscal_year INTEGER NOT NULL,reference TEXT NOT NULL,PRIMARY KEY(unit_id,community_id,fiscal_year));
    CREATE TABLE calendar_events(id INTEGER PRIMARY KEY,title TEXT NOT NULL,date TEXT NOT NULL,start_time TEXT,end_time TEXT,unit_id INTEGER NOT NULL REFERENCES units(id),work_id INTEGER REFERENCES works(id),owner_id INTEGER NOT NULL REFERENCES users(id),source_text TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE calendar_attendees(event_id INTEGER NOT NULL REFERENCES calendar_events(id),user_id INTEGER NOT NULL REFERENCES users(id),PRIMARY KEY(event_id,user_id));
    CREATE TABLE hr_templates(id INTEGER PRIMARY KEY,name TEXT NOT NULL,personnel_type TEXT NOT NULL,headings TEXT NOT NULL,reference TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,version INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE hr_exports(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),payload TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE line_login_states(state_hash TEXT PRIMARY KEY,nonce TEXT NOT NULL,code_verifier TEXT NOT NULL,expires_at INTEGER NOT NULL);
    CREATE TABLE line_registrations(token_hash TEXT PRIMARY KEY,line_user_id TEXT NOT NULL,display_name TEXT NOT NULL,avatar_url TEXT,expires_at INTEGER NOT NULL);
    CREATE TABLE line_link_codes(code_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL);
    CREATE TABLE role_requests(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),requested_role TEXT NOT NULL,unit_id INTEGER REFERENCES units(id),work_id INTEGER REFERENCES works(id),status TEXT NOT NULL DEFAULT 'pending',resolved_by INTEGER REFERENCES users(id),reason TEXT NOT NULL DEFAULT '');
    CREATE TABLE line_events(event_id TEXT PRIMARY KEY,state TEXT NOT NULL DEFAULT 'received',error TEXT,payload TEXT,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE line_conversations(line_user_id TEXT PRIMARY KEY,payload TEXT NOT NULL,expires_at INTEGER NOT NULL);
    CREATE TABLE workflow_proposals(id INTEGER PRIMARY KEY,owner_id INTEGER NOT NULL REFERENCES users(id),kind TEXT NOT NULL,source_text TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',result_id INTEGER,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE scope_job_runs(day TEXT PRIMARY KEY);
    CREATE TABLE file_reviews(file_id INTEGER PRIMARY KEY REFERENCES files(id),reviewed_by INTEGER NOT NULL REFERENCES users(id),reviewed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE media_retention(id INTEGER PRIMARY KEY,file_id INTEGER NOT NULL REFERENCES files(id),state TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE INDEX activity_owner_date ON activities(owner_id,date);
    CREATE INDEX activity_unit_date ON activities(unit_id,date);
    CREATE INDEX activity_people_user ON activity_people(user_id,activity_id);
    CREATE INDEX notification_user_time ON notifications(user_id,id);
    CREATE INDEX delegation_user_dates ON delegation_grants(grantee_id,starts_at,ends_at);
    CREATE INDEX period_unit_dates ON period_locks(unit_id,date_from,date_to);
    CREATE INDEX scheduled_user_time ON scheduled_summaries(user_id,id);
    CREATE INDEX calendar_event_dates ON calendar_events(date);
    INSERT INTO schema_migrations(version) VALUES(11);
    COMMIT;`);
  if (!db.prepare("SELECT 1 FROM schema_migrations WHERE version=12").get())
    db.exec(`BEGIN IMMEDIATE;
      ALTER TABLE projects ADD COLUMN source_text TEXT NOT NULL DEFAULT '';
      ALTER TABLE projects ADD COLUMN submission_key TEXT;
      CREATE UNIQUE INDEX project_submission_key ON projects(submission_key) WHERE submission_key IS NOT NULL;
      ALTER TABLE project_tasks ADD COLUMN start_time TEXT;
      ALTER TABLE project_tasks ADD COLUMN end_time TEXT;
      ALTER TABLE project_tasks ADD COLUMN source_quote TEXT NOT NULL DEFAULT '';
      INSERT INTO schema_migrations(version) VALUES(12);
      COMMIT;`);
  const defaults = {
    reminders_enabled: true,
    summaries_enabled: true,
    skip_weekends: true,
    holidays: [],
    escalate_after_days: 3,
    escalate_executive_after_days: 7,
    line_reply_enabled: false,
    line_reminders_enabled: true,
    ai_min_confidence: 0.8,
    retention_days: null,
    retention_enabled: false,
  };
  for (const [k, v] of Object.entries(defaults))
    db.prepare("INSERT OR IGNORE INTO scope_settings VALUES(?,?)").run(
      k,
      JSON.stringify(v),
    );
}
