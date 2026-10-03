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
          unit: z.enum([
            "กิจกรรม",
            "ครั้ง",
            "ครั้งบริการ",
            "คน",
            "ตัน",
            "หลังคาเรือน",
            "แห่ง",
            "กิโลกรัม",
          ]),
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
      .min(1)
      .max(5)
      .transform((v) => [...new Set(v)]),
    scopes: z.array(id).max(100).default([]),
    active: z.boolean().default(true),
    line_user_id: z
      .string()
      .regex(/^U[0-9a-f]{32}$/)
      .nullable()
      .default(null),
  })
  .superRefine((v, c) => {
    if (v.roles.includes("head") && !v.scopes.length)
      c.addIssue({
        code: "custom",
        path: ["scopes"],
        message: "หัวหน้าฝ่ายต้องมีหน่วยงานที่รับผิดชอบ",
      });
    if (v.roles.includes("staff") && !v.unit_id)
      c.addIssue({
        code: "custom",
        path: ["unit_id"],
        message: "เจ้าหน้าที่ต้องมีสังกัด",
      });
    if (v.roles.includes("staff") && !v.work_id)
      c.addIssue({
        code: "custom",
        path: ["work_id"],
        message: "กรุณากำหนดงานประจำให้เจ้าหน้าที่ 1 งานในฝ่ายที่สังกัด",
      });
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
