import { httpError } from "./security.js";
import { writeAudit } from "./db.js";
export function effectiveUser(db, user, now = new Date().toISOString()) {
  const scopes = new Set(user.scopes),
    works = new Set(user.work_scopes || []);
  const grants = db
    .prepare(
      "SELECT * FROM delegation_grants WHERE grantee_id=? AND revoked=0 AND starts_at<=? AND ends_at>=?",
    )
    .all(user.id, now, now);
  const validGrants = grants.filter((g) => {
    const u = db
      .prepare(
        "SELECT roles,scopes,work_scopes FROM users WHERE id=? AND active=1",
      )
      .get(g.grantor_id);
    return (
      u &&
      (g.unit_id
        ? JSON.parse(u.roles).includes("head") &&
          JSON.parse(u.scopes).includes(g.unit_id)
        : JSON.parse(u.roles).includes("center_head") &&
          !!db
            .prepare(
              "WITH RECURSIVE tree(id) AS (SELECT value FROM json_each(?) UNION SELECT w.id FROM works w JOIN tree t ON w.parent_id=t.id) SELECT 1 FROM tree WHERE id=?",
            )
            .get(u.work_scopes, g.work_id))
    );
  });
  for (const g of validGrants) {
    if (g.unit_id) scopes.add(g.unit_id);
    if (g.work_id) works.add(g.work_id);
  }
  for (const id of [...works])
    for (const w of db
      .prepare(
        "WITH RECURSIVE tree(id) AS (SELECT id FROM works WHERE id=? UNION ALL SELECT w.id FROM works w JOIN tree t ON w.parent_id=t.id) SELECT id FROM tree",
      )
      .all(id))
      works.add(w.id);
  return {
    ...user,
    scopes: [...scopes],
    work_scopes: [...works],
    delegated: validGrants.length > 0,
  };
}
export function contentScope(user, alias = "a") {
  if (user.roles.includes("executive")) return { sql: "1=1", params: [] };
  const parts = [
      `${alias}.owner_id=?`,
      `EXISTS(SELECT 1 FROM activity_people p WHERE p.activity_id=${alias}.id AND p.user_id=?)`,
    ],
    params = [user.id, user.id];
  if ((user.roles.includes("head") || user.delegated) && user.scopes.length) {
    parts.push(
      `(${alias}.unit_id IN (${user.scopes.map(() => "?")}) OR EXISTS(SELECT 1 FROM activity_units au WHERE au.activity_id=${alias}.id AND au.unit_id IN (${user.scopes.map(() => "?")})))`,
    );
    params.push(...user.scopes, ...user.scopes);
  }
  if (
    (user.roles.includes("center_head") || user.delegated) &&
    user.work_scopes.length
  ) {
    parts.push(`${alias}.work_id IN (${user.work_scopes.map(() => "?")})`);
    params.push(...user.work_scopes);
  }
  if (user.roles.includes("pr"))
    parts.push(
      `(EXISTS(SELECT 1 FROM news_candidates nc WHERE nc.activity_id=${alias}.id AND nc.state!='dismissed') OR EXISTS(SELECT 1 FROM news n WHERE n.activity_id=${alias}.id))`,
    );
  return { sql: "(" + parts.join(" OR ") + ")", params };
}
export function canRead(db, user, row) {
  if (!row) return false;
  const s = contentScope(user);
  return !!db
    .prepare(`SELECT 1 FROM activities a WHERE a.id=? AND ${s.sql}`)
    .get(row.id, ...s.params);
}
export function assertRead(db, user, row, { audit = false } = {}) {
  if (!canRead(db, user, row))
    throw httpError(404, "ไม่พบรายงานในขอบเขตสิทธิ์");
  if (audit && row.owner_id !== user.id)
    writeAudit(db, user, "เปิดอ่านรายงานของผู้อื่น", "activity", row.id, null, {
      source_version: row.version,
    });
}
export function manages(user, row) {
  return (
    ((user.roles.includes("head") || user.delegated) &&
      user.scopes.includes(row.unit_id)) ||
    ((user.roles.includes("center_head") || user.delegated) &&
      user.work_scopes.includes(row.work_id))
  );
}
export function fileScope(user, alias = "f") {
  const a = contentScope(user),
    parts = [`${alias}.owner_id=?`],
    params = [user.id];
  if (user.roles.includes("executive")) return { sql: "1=1", params: [] };
  if ((user.roles.includes("head") || user.delegated) && user.scopes.length) {
    parts.push(`${alias}.unit_id IN (${user.scopes.map(() => "?")})`);
    params.push(...user.scopes);
  }
  if (
    (user.roles.includes("center_head") || user.delegated) &&
    user.work_scopes.length
  ) {
    parts.push(`${alias}.work_id IN (${user.work_scopes.map(() => "?")})`);
    params.push(...user.work_scopes);
  }
  parts.push(
    `EXISTS(SELECT 1 FROM activities a WHERE a.id=${alias}.activity_id AND ${a.sql})`,
  );
  params.push(...a.params);
  // Published images are visible in the internal news feed, without opening the underlying report.
  parts.push(
    `EXISTS(SELECT 1 FROM news n,json_each(n.image_ids) j WHERE n.status='published' AND j.value=${alias}.id)`,
  );
  return { sql: "(" + parts.join(" OR ") + ")", params };
}
export function assertFileRead(db, user, id) {
  const s = fileScope(user);
  if (
    !db
      .prepare(`SELECT 1 FROM files f WHERE f.id=? AND ${s.sql}`)
      .get(id, ...s.params)
  )
    throw httpError(404, "ไม่พบไฟล์ในขอบเขตสิทธิ์");
}
export function lockFor(db, row) {
  if (!row.date) return null;
  return (
    db
      .prepare(
        "SELECT * FROM period_locks WHERE active=1 AND unit_id=? AND date_from<=? AND date_to>=? LIMIT 1",
      )
      .get(row.unit_id, row.date, row.date) || null
  );
}
export function assertUnlocked(db, user, row) {
  const l = lockFor(db, row);
  if (
    l &&
    !db
      .prepare(
        "SELECT 1 FROM amendment_grants WHERE activity_id=? AND user_id=? AND expires_at>?",
      )
      .get(row.id, user.id, new Date().toISOString())
  )
    throw httpError(409, "ปิดรอบรายงานแล้ว กรุณาขอแก้ไขจากหัวหน้าก่อน");
}

export function privateFileReadable(db, user, file) {
  return Boolean(
    file &&
    (user.roles.includes("executive") ||
      file.owner_id === user.id ||
      manages(user, file) ||
      (file.activity_id && canRead(db, user, { id: file.activity_id }))),
  );
}
export function fileMetadata(db, user, file) {
  if (privateFileReadable(db, user, file)) return file;
  return {
    ...file,
    title: "รูปประกอบข่าว",
    original_name:
      "news-image." +
      ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[
        file.mime
      ] || "bin"),
    description: "",
    keywords: "",
    owner_name: "",
    owner_id: null,
    activity_id: null,
  };
}
export function auditForUser(db, user, entry) {
  const configuration = new Set([
    "user",
    "units",
    "works",
    "categories",
    "scope_settings",
    "summary_template",
    "hr_template",
    "delegation",
    "period_lock",
    "role_request",
    "scheduler",
    "line_event",
  ]);
  let allowed = configuration.has(entry.entity),
    row;
  if (entry.entity === "activity")
    allowed = canRead(db, user, { id: entry.entity_id });
  else if (entry.entity === "file")
    allowed = privateFileReadable(
      db,
      user,
      db.prepare("SELECT * FROM files WHERE id=?").get(entry.entity_id),
    );
  else if (
    ["project", "plan", "project_task", "project_expense"].includes(
      entry.entity,
    )
  ) {
    if (entry.entity === "project")
      row = db
        .prepare("SELECT * FROM projects WHERE id=?")
        .get(entry.entity_id);
    if (entry.entity === "plan")
      row = db.prepare("SELECT * FROM plans WHERE id=?").get(entry.entity_id);
    if (entry.entity === "project_task")
      row = db
        .prepare(
          "SELECT p.* FROM project_tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=?",
        )
        .get(entry.entity_id);
    if (entry.entity === "project_expense")
      row = db
        .prepare(
          "SELECT p.* FROM project_expenses e JOIN projects p ON p.id=e.project_id WHERE e.id=?",
        )
        .get(entry.entity_id);
    allowed = !!row && (user.roles.includes("executive") || manages(user, row));
  } else if (entry.entity === "news") allowed = user.roles.includes("pr");
  else if (entry.entity === "hr_export")
    allowed = !!db
      .prepare("SELECT 1 FROM hr_exports WHERE id=? AND user_id=?")
      .get(entry.entity_id, user.id);
  else if (entry.entity === "workflow_proposal")
    allowed = !!db
      .prepare("SELECT 1 FROM workflow_proposals WHERE id=? AND owner_id=?")
      .get(entry.entity_id, user.id);
  else if (entry.entity === "summary_draft") {
    const draft = db
      .prepare("SELECT * FROM summary_drafts WHERE id=?")
      .get(entry.entity_id);
    allowed =
      !!draft &&
      (draft.owner_id === user.id ||
        user.roles.some((r) =>
          ["head", "center_head", "executive"].includes(r),
        ) ||
        user.delegated) &&
      JSON.parse(draft.snapshot_json).rows.every((r) => canRead(db, user, r));
  }
  if (allowed) return entry;
  const before = JSON.parse(entry.before_json || "{}"),
    after = JSON.parse(entry.after_json || "{}");
  return {
    ...entry,
    before_json: null,
    after_json: null,
    redacted: true,
    changed_fields: [
      ...new Set([...Object.keys(before), ...Object.keys(after)]),
    ].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])),
  };
}
