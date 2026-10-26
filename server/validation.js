import { metricUnits } from "../shared/metric-units.js";
import { z } from "zod";
import { ROLES } from "./db.js";
const optionalText = (max = 2000) => z.string().trim().max(max).default("");
export const id = z.number().int().positive();
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const parsed = new Date(v);
    return (
      !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === v
    );
  }, "วันที่ไม่ถูกต้อง");
export const activitySchema = z
  .object({
    news_requested: z.boolean().default(false),
    brief: z.boolean().default(false),
    source_text: z.string().max(20000).default(""),
    intake: z.boolean().default(false),
    intake_key: z.string().uuid().nullish(),
    title: z.string().trim().min(1).max(300),
    date: date.nullable().default(null),
    unit_id: id,
    work_id: id.nullable().default(null),
    category_id: id.nullable().default(null),
    area: optionalText(300),
    workers: optionalText(),
    result: optionalText(10000),
    metrics: z
      .array(
        z.object({
          label: z.string().trim().min(1).max(100),
          value: z.number().finite().min(0).max(1e12),
          unit: z.enum(metricUnits),
        }),
      )
      .max(20)
      .default([]),
    status: z.enum(["pending", "ready"]).default("pending"),
    file_ids: z.array(id).max(100).default([]),
    inbox_ids: z.array(id).max(100).default([]),
    version: id.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.status === "ready")
      for (const k of ["date", "category_id", "area", "workers", "result"])
        if (!v[k])
          ctx.addIssue({
            code: "custom",
            path: [k],
            message: "กรุณากรอกข้อมูลก่อนเปลี่ยนเป็นพร้อมสรุป",
          });
  });
export const userSchema = z
  .object({
    username: z
      .string()
      .trim()
      .regex(/^[a-zA-Z0-9._-]{3,60}$/),
    name: z.string().trim().min(1).max(200),
    password: z.string().min(12).max(128).optional(),
    unit_id: id.nullable(),
    work_id: id.nullable().default(null),
    roles: z
      .array(z.enum(Object.keys(ROLES)))
      .length(1, "เลือกตำแหน่ง/บทบาทหลักได้เพียง 1 อย่าง"),
    scopes: z.array(id).max(1, "หัวหน้าฝ่ายรับผิดชอบได้ 1 ฝ่าย").default([]),
    work_scopes: z.array(id).max(1, "เลือกงาน/ศูนย์หลักได้ 1 แห่ง").default([]),
    personnel_type: optionalText(100),
    position: optionalText(200),
    active: z.boolean().default(true),
    line_user_id: z
      .string()
      .regex(/^U[0-9a-f]{32}$/)
      .nullable()
      .default(null),
  })
  .superRefine((v, c) => {
    const role = v.roles[0],
      issue = (key, message) =>
        c.addIssue({ code: "custom", path: [key], message });
    if (["staff", "pr"].includes(role)) {
      if (!v.unit_id) issue("unit_id", "กรุณาเลือกฝ่ายหลัก 1 ฝ่าย");
      if (!v.work_id)
        issue("work_id", "กรุณาเลือกงานหลัก 1 งานในฝ่ายที่สังกัด");
      if (v.scopes.length || v.work_scopes.length)
        issue("scopes", "บทบาทนี้ไม่ใช้ขอบเขตหัวหน้าฝ่ายหรือหัวหน้าศูนย์");
    } else if (role === "head") {
      const unit = v.unit_id || v.scopes[0];
      if (!unit)
        issue("unit_id", "หัวหน้าฝ่ายต้องเลือกฝ่ายที่รับผิดชอบ 1 ฝ่าย");
      if (v.unit_id && v.scopes[0] && v.unit_id !== v.scopes[0])
        issue("scopes", "ฝ่ายต้นสังกัดและฝ่ายที่รับผิดชอบต้องเป็นฝ่ายเดียวกัน");
      if (v.work_id || v.work_scopes.length)
        issue(
          "work_id",
          "หัวหน้าฝ่ายรับผิดชอบทั้งฝ่าย ไม่กำหนดงานประจำแยกอีกแห่ง",
        );
    } else if (role === "center_head") {
      const work = v.work_id || v.work_scopes[0];
      if (!v.unit_id || !work)
        issue("work_id", "หัวหน้าศูนย์ต้องเลือกฝ่ายและงาน/ศูนย์หลัก 1 แห่ง");
      if (v.scopes.length)
        issue("scopes", "หัวหน้าศูนย์ไม่กำหนดขอบเขตหัวหน้าฝ่าย");
      if (v.work_id && v.work_scopes[0] && v.work_id !== v.work_scopes[0])
        issue("work_scopes", "งานหลักและงานที่รับผิดชอบต้องตรงกัน");
    } else if (
      v.unit_id ||
      v.work_id ||
      v.scopes.length ||
      v.work_scopes.length
    )
      issue(
        "unit_id",
        "ผู้บริหารและแอดมินอยู่ระดับสำนัก ไม่เลือกฝ่ายหรืองานซ้ำ",
      );
  })
  .transform((v) => {
    const role = v.roles[0];
    if (role === "head") {
      const unit = v.unit_id || v.scopes[0];
      return {
        ...v,
        unit_id: unit,
        work_id: null,
        scopes: [unit],
        work_scopes: [],
      };
    }
    if (role === "center_head") {
      const work = v.work_id || v.work_scopes[0];
      return { ...v, work_id: work, scopes: [], work_scopes: [work] };
    }
    return { ...v, scopes: [], work_scopes: [] };
  });
export const newsSchema = z.object({
  activity_id: id,
  title: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(20000),
  image_ids: z.array(id).max(30).default([]),
  cover_id: id.nullable().default(null),
  version: id.optional(),
});
export const loginSchema = z.object({
  username: z.string().trim().min(1).max(60),
  password: z.string().min(1).max(128),
});
export const masterSchema = z.object({
  name: z
    .string()
    .transform((v) => v.normalize("NFC").trim().replace(/\s+/g, " "))
    .pipe(z.string().min(1).max(200)),
  active: z.boolean().default(true),
  parent_id: id.nullable().default(null),
  kind: z.enum(["section", "division", "group"]).default("division"),
});
export const workSchema = masterSchema.extend({ unit_id: id });
