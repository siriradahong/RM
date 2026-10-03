import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../server/db.js";
import { seedDemo } from "../scripts/seed-demo.mjs";
import { createApp } from "../server/app.js";
import { hashPassword } from "../server/security.js";

test("demo dataset preserves existing data, loads real assets, covers roles and is idempotent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rm-demo-check-"));
  let db, server;
  try {
    ({ db } = openDatabase(dir));
    db.prepare(
      "INSERT INTO users(username,name,password_hash,roles) VALUES('existing-user','existing name',?,'[\"admin\"]')",
    ).run(await hashPassword("Existing-private-password!"));
    const existing = db
      .prepare("SELECT * FROM users WHERE username='existing-user'")
      .get();
    db.close();
    db = null;
    const result = await seedDemo({
      dataDir: dir,
      today: "2026-10-03",
      backupExisting: false,
    });
    assert.deepEqual(result.manifest.counts, {
      accounts: 13,
      activities: 18,
      ready: 14,
      pending: 4,
      files: 9,
      publishedNews: 4,
      draftNews: 2,
      simulatedInbox: 5,
      unlinkedInbox: 3,
    });
    ({ db } = openDatabase(dir));
    assert.deepEqual(
      db.prepare("SELECT * FROM users WHERE id=?").get(existing.id),
      existing,
    );
    const snapshots = Object.fromEntries(
      ["users", "activities", "files", "news", "inbox", "audits"].map((t) => [
        t,
        db.prepare(`SELECT * FROM ${t} ORDER BY id`).all(),
      ]),
    );
    const again = await seedDemo({
      dataDir: dir,
      today: "2026-10-04",
      backupExisting: false,
    });
    assert.equal(again.alreadySeeded, true);
    for (const [t, rows] of Object.entries(snapshots))
      assert.deepEqual(
        db.prepare(`SELECT * FROM ${t} ORDER BY id`).all(),
        rows,
      );
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) n FROM activities WHERE date>='2026-10-01' AND status='ready'",
        )
        .get().n,
      9,
    );
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
    for (const f of snapshots.files) {
      const info = await stat(join(dir, "uploads", f.storage_name));
      assert.equal(info.size, f.size);
      assert.ok(f.title.startsWith("[สาธิต]"));
    }
    assert.ok(
      snapshots.news.every(
        (n) => n.line_status === "not_sent" && !n.line_sent_at,
      ),
    );
    const credentials = await readFile(result.accountsPath, "utf8");
    const password = credentials.match(/รหัสผ่านร่วม[^`]*`([^`]+)`/)[1];
    assert.equal((await stat(result.accountsPath)).mode & 0o777, 0o600);
    db.close();
    db = null;
    const app = createApp({ dataDir: dir, disableRateLimit: true });
    db = app.locals.db;
    server = await new Promise((resolve, reject) => {
      const s = app.listen(0, "127.0.0.1");
      s.once("listening", () => resolve(s));
      s.once("error", reject);
    });
    const base = `http://127.0.0.1:${server.address().port}/api`;
    for (const [username, role] of [
      ["demo.staff.health-promotion", "staff"],
      ["demo.head", "head"],
      ["demo.executive", "executive"],
      ["demo.pr", "pr"],
      ["demo.admin", "admin"],
    ]) {
      const r = await fetch(base + "/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3001",
        },
        body: JSON.stringify({ username, password }),
      });
      assert.equal(r.status, 200);
      const auth = await r.json();
      assert.deepEqual(auth.user.roles, [role]);
      const cookie = r.headers.get("set-cookie").split(";")[0];
      async function get(path) {
        const r = await fetch(base + path, { headers: { Cookie: cookie } });
        assert.equal(r.status, 200, path);
        return r.json();
      }
      assert.equal((await get("/meta")).demo.activityCount, 18);
      assert.equal(
        (await get("/dashboard?from=2026-10-01&to=2026-10-03")).ready,
        9,
      );
      assert.equal((await get("/news?feed=1")).total, 4);
      if (role === "pr")
        assert.equal((await get("/news?status=draft")).total, 2);
      if (role === "admin") {
        assert.equal((await get("/admin/line")).lastReceived, null);
        assert.equal((await get("/admin/users")).length, 14);
      }
      if (role === "staff") assert.ok(auth.user.work_id);
      const f = await fetch(
        base + "/files/" + result.manifest.fileIds[0] + "/content",
        { headers: { Cookie: cookie } },
      );
      assert.equal(f.status, 200);
      assert.ok((await f.arrayBuffer()).byteLength > 1000);
    }
  } finally {
    if (server) await new Promise((r) => server.close(r));
    db?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
