import React, { useEffect, useState } from "react";
import { api } from "./api";
export function ReportDraft({ exportId, user, modelConfigured }) {
  const [open, setOpen] = useState(false),
    [list, setList] = useState([]),
    [draft, setDraft] = useState(null),
    [snapshot, setSnapshot] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function load() {
    const [rows, source] = await Promise.all([
      api("/report-exports/" + exportId + "/drafts"),
      api("/report-exports/" + exportId),
    ]);
    setList(rows);
    setSnapshot(source);
  }
  useEffect(() => {
    if (open) load().catch((e) => setError(e.message));
  }, [open, exportId]);
  async function act(generate, confirm = false) {
    setBusy(true);
    setError("");
    try {
      const d = await api(
        generate
          ? "/report-exports/" + exportId + "/drafts"
          : "/report-drafts/" + draft.id,
        {
          method: generate ? "POST" : "PUT",
          body: generate
            ? {}
            : { sections: draft.sections, version: draft.version, confirm },
        },
      );
      setDraft(d);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details
      className="rm-report-draft"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>ร่างคำบรรยายสรุปและตรวจต้นทาง</summary>
      {open && (
        <>
          <p className="rm-notice">
            ตัวเลขตารางมาจากฉบับสรุปที่เก็บไว้ โมเดลช่วยร่างข้อความ
            เจ้าของร่างต้องเทียบหลักฐานและยืนยันก่อนส่งออก
          </p>
          {error && (
            <p role="alert" className="rm-notice error">
              {error}
            </p>
          )}
          <button
            className="rm-button secondary"
            disabled={busy || !modelConfigured}
            onClick={() => act(true)}
          >
            {busy ? "กำลังประมวลผล…" : "สร้างร่างด้วยโมเดล"}
          </button>
          {!modelConfigured && (
            <p>ยังไม่ได้ตั้งค่าโมเดล สามารถดาวน์โหลดรายงานสรุปปกติด้านบนได้</p>
          )}
          <div className="rm-row">
            {list.map((d) => (
              <button
                key={d.id}
                className="rm-button secondary"
                onClick={() => setDraft(d)}
              >
                ร่าง #{d.id} ·{" "}
                {d.status === "confirmed" ? "ยืนยันแล้ว" : "รอตรวจ"}
              </button>
            ))}
          </div>
          {draft && (
            <section className="rm-stack">
              <small>
                โมเดล: {draft.engine} · ฉบับร่าง #{draft.id}
              </small>
              {draft.sections.map((s, i) => (
                <div key={i}>
                  <h4>{s.heading}</h4>
                  {draft.can_edit && draft.owner_id === user.id ? (
                    <textarea
                      aria-label={"แก้คำบรรยาย " + s.heading}
                      rows={5}
                      maxLength={6000}
                      value={s.body}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          sections: draft.sections.map((x, j) =>
                            j === i ? { ...x, body: e.target.value } : x,
                          ),
                        })
                      }
                    />
                  ) : (
                    <p className="news-body">{s.body}</p>
                  )}
                  <details>
                    <summary>
                      เทียบกับต้นฉบับ ณ เวลาสร้างรายงาน ({s.activity_ids.length}{" "}
                      รายการ)
                    </summary>
                    {s.activity_ids.map((id) => {
                      const a = snapshot?.activities.find((a) => a.id === id);
                      return (
                        <blockquote key={id}>
                          #{id} / v{a?.version} · {a?.date} · {a?.title}
                          <p>{a?.result}</p>
                          {a?.metrics?.map((m, j) => (
                            <small key={j}>
                              {m.label}: {m.value} {m.unit} ·{" "}
                            </small>
                          ))}
                        </blockquote>
                      );
                    })}
                  </details>
                </div>
              ))}
              {draft.can_edit && draft.owner_id === user.id ? (
                <div className="rm-row">
                  <button
                    className="rm-button secondary"
                    disabled={busy}
                    onClick={() => act(false)}
                  >
                    บันทึกร่าง
                  </button>
                  <button
                    className="rm-button"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          "ตรวจข้อความและตัวเลขเทียบกับต้นทางแล้ว ยืนยันฉบับใช้งาน? ฉบับนี้จะแก้ทับไม่ได้",
                        )
                      )
                        act(false, true);
                    }}
                  >
                    ตรวจแล้ว · ยืนยันฉบับใช้งาน
                  </button>
                </div>
              ) : (
                draft.status === "confirmed" && (
                  <div className="rm-row">
                    <a
                      className="rm-button"
                      href={`/api/report-drafts/${draft.id}/download?format=docx`}
                    >
                      Word ฉบับยืนยัน
                    </a>
                    <a
                      className="rm-button secondary"
                      target="_blank"
                      rel="noopener noreferrer"
                      href={`/api/report-drafts/${draft.id}/download?format=html`}
                    >
                      พิมพ์ / บันทึก PDF
                    </a>
                  </div>
                )
              )}
            </section>
          )}
        </>
      )}
    </details>
  );
}
