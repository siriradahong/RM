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
export function canEdit(user, record) {
  return (
    (user.roles.includes("staff") && record.owner_id === user.id) ||
    (user.roles.includes("head") && user.scopes.includes(record.unit_id))
  );
}
export function canCreate(user, unitId) {
  return (
    (user.roles.includes("staff") && user.unit_id === unitId) ||
    (user.roles.includes("head") && user.scopes.includes(unitId))
  );
}
export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}
