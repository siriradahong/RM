import React, { useState } from "react";
import { api, query } from "./api";
import { useData, DataState, Button, Field } from "./workspace-ui";
export default function DuplicateReview({ record, onChanged, navigate }) {
  const resource = useData(`/activities/${record.id}/duplicates`),
    [target, setTarget] = useState(""),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState("");
  const choices = useData(
    "/activities?" +
      query({ unit: record.unit_id, status: "ready", q: search, limit: 100 }),
  );
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/activities/${record.id}/duplicate`, {
        method: "PUT",
        body: {
          version: record.version,
          duplicate_of: record.duplicate_of ? null : Number(target),
          reason,
        },
      });
      await onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <DataState resource={resource}>
      {(d) => (
        <details
          className={
            "panel duplicate-review " + (d.items.length ? "has-candidates" : "")
          }
          open={record.duplicate_of ? true : undefined}
        >
          <summary>
            {record.duplicate_of
              ? "ยืนยันแล้วว่าเป็นรายการซ้ำ — ไม่รวมในสรุป"
              : d.items.length
                ? `พบ ${d.items.length} รายการที่อาจซ้ำ · เปิดตรวจเทียบ`
                : "ตรวจรายการซ้ำ"}
          </summary>
          {d.canonical && (
            <p>
              รายงานหลัก:{" "}
              <button
                className="table-link"
                onClick={() => navigate("activity/" + d.canonical.id)}
              >
                #{d.canonical.id} {d.canonical.title}
              </button>
              <br />
              เหตุผล: {record.duplicate_reason}
            </p>
          )}
          <p className="muted">
            ตรวจต้นฉบับก่อนยืนยัน รายการซ้ำยังเก็บข้อความ ไฟล์ และประวัติไว้ครบ
          </p>
          {d.items.map((r) => (
            <div key={r.id} className="duplicate-candidate">
              <button
                className="table-link"
                onClick={() => navigate("activity/" + r.id)}
              >
                #{r.id} {r.title} · {r.owner_name}
              </button>
              <small>
                {r.status === "ready" ? "พร้อมสรุป" : "ยังต้องตรวจข้อมูล"}
              </small>
            </div>
          ))}
          {record.can_edit && !record.locked_by_project && (
            <form className="form" onSubmit={save}>
              {!record.duplicate_of && (
                <div className="duplicate-choices">
                  <Field label="ค้นหารายงานหลัก">
                    <input
                      value={search}
                      placeholder="พิมพ์ชื่อเรื่องหรือคำสำคัญ"
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </Field>
                  <Field label="เลือกรายงานหลักที่ยืนยันแล้ว">
                    <select
                      required
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                    >
                      <option value="">
                        เลือกรายงานที่เป็นกิจกรรมเดียวกัน
                      </option>
                      {(choices.data?.items || [])
                        .filter((r) => r.id !== record.id)
                        .map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.title} · {r.date} · {r.owner_name}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <p className="muted">
                    แสดง 100 รายการแรกในฝ่ายเดียวกัน ใช้คำค้นเพื่อจำกัดรายการ
                  </p>
                  {choices.error && <p role="alert">{choices.error}</p>}
                </div>
              )}
              <Field label="เหตุผลการตรวจรายการซ้ำ">
                <textarea
                  required
                  minLength={3}
                  maxLength={1000}
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
              {error && <p role="alert">{error}</p>}
              <Button disabled={busy}>
                {record.duplicate_of
                  ? "ยกเลิกการระบุว่าซ้ำ"
                  : "ยืนยันว่าซ้ำ ไม่รวมยอด"}
              </Button>
            </form>
          )}
        </details>
      )}
    </DataState>
  );
}
