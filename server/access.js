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
