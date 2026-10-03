import { test } from "node:test";
import assert from "node:assert/strict";
import { api } from "../src/api.js";

test("preserves cancellation while reading a response body", async (t) => {
  t.mock.method(globalThis, "fetch", async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new DOMException("Body cancelled", "AbortError");
    },
  }));
  await assert.rejects(api("/dashboard"), { name: "AbortError" });
});

test("rejects invalid JSON instead of passing an error object to the dashboard", async (t) => {
  t.mock.method(globalThis, "fetch", async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError("Invalid JSON");
    },
  }));
  await assert.rejects(api("/dashboard"), /การตอบกลับจากเซิร์ฟเวอร์ไม่ถูกต้อง/);
});

test("retains successful API responses", async (t) => {
  const data = { ready: 1, metrics: [], months: [], byCategory: [] };
  t.mock.method(globalThis, "fetch", async () => ({
    ok: true,
    json: async () => data,
  }));
  assert.deepEqual(await api("/dashboard"), data);
});
