import {
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(scryptCb);
export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${hash.toString("hex")}`;
}
export async function verifyPassword(password, encoded) {
  const [, salt, expected] = encoded.split(":");
  if (!salt || !expected) return false;
  const hash = await scrypt(password, salt, 64);
  const target = Buffer.from(expected, "hex");
  return hash.length === target.length && timingSafeEqual(hash, target);
}
export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
export const token = () => randomBytes(32).toString("hex");
export const isHeadForUnit = (user, unitId) =>
  user.roles.includes("head") && user.scopes.includes(unitId);
export function canEdit(user, record) {
  return (
    (user.roles.includes("staff") && record.owner_id === user.id) ||
    isHeadForUnit(user, record.unit_id)
  );
}
export function canCreate(user, unitId) {
  return (
    (user.roles.includes("staff") && user.unit_id === unitId) ||
    isHeadForUnit(user, unitId)
  );
}
export function requireStaffAssignment(db, user) {
  const assignment = db
    .prepare(
      "SELECT w.id AS work_id,w.unit_id FROM works w JOIN units u ON u.id=w.unit_id WHERE w.id=? AND w.unit_id=? AND w.active=1 AND u.active=1 AND u.kind!='section'",
    )
    .get(user.work_id ?? null, user.unit_id ?? null);
  if (!assignment)
    throw httpError(
      403,
      "บัญชีนี้ยังไม่มีฝ่ายและงานที่พร้อมใช้งาน กรุณาติดต่อผู้ดูแลระบบเพื่อกำหนดฝ่ายและงานประจำก่อนบันทึกข้อมูลใหม่",
    );
  return assignment;
}
export function createWorkAssignment(db, user, unitId, workId) {
  // A head's explicit scope remains additive, even on a staff+head account.
  if (isHeadForUnit(user, unitId)) return workId ?? null;
  if (!user.roles.includes("staff"))
    throw httpError(403, "ไม่มีสิทธิ์บันทึกข้อมูลในฝ่ายนี้");
  const assignment = requireStaffAssignment(db, user);
  if (
    unitId !== assignment.unit_id ||
    (workId != null && workId !== assignment.work_id)
  )
    throw httpError(
      403,
      "พนักงานบันทึกได้เฉพาะฝ่ายและงานที่ผู้ดูแลระบบกำหนดให้เท่านั้น",
    );
  return assignment.work_id;
}
export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}
