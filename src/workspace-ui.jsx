import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "./api";
export function useData(path) {
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    api(path, { signal: controller.signal })
      .then((d) => {
        if (!controller.signal.aborted) setData(d);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [path, revision]);
  return { data, error, reload: () => setRevision((n) => n + 1) };
}
export const Button = ({ primary, children, ...props }) => (
  <button
    type={props.onClick ? "button" : "submit"}
    className={`button ${primary ? "primary" : ""}`}
    {...props}
  >
    {children}
  </button>
);
export function ReportSteps({ step }) {
  return (
    <ol className="flow-steps no-print" aria-label="ขั้นตอนจัดทำรายงาน">
      {["เลือกข้อมูล", "ตรวจร่าง", "ดาวน์โหลด"].map((label, i) => (
        <li
          key={label}
          aria-current={step === i + 1 ? "step" : undefined}
          className={i + 1 <= step ? "current" : ""}
        >
          <span>{i + 1 < step ? "✓" : i + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}
export function ReportTabs({ page, navigate }) {
  return (
    <div
      className="section-tabs no-print"
      role="navigation"
      aria-label="หน้าสรุปผลงาน"
    >
      <button
        className={page === "reports" ? "active" : ""}
        onClick={() => navigate("reports")}
      >
        ภาพรวมผลงาน
      </button>
      <button
        className={page === "drafts" ? "active" : ""}
        onClick={() => navigate("drafts")}
      >
        รายงานที่จัดทำไว้
      </button>
    </div>
  );
}
export function Field({ label, children }) {
  const id = React.useId();
  return (
    <label className="field" htmlFor={id}>
      <span id={id + "-label"}>{label}</span>
      {React.cloneElement(children, { id, "aria-labelledby": id + "-label" })}
    </label>
  );
}
export const dateText = (s) =>
  s
    ? new Date(s).toLocaleDateString("th-TH", {
        timeZone: "Asia/Bangkok",
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "ยังไม่ระบุ";
export const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(
    new Date(),
  );
export function Heading({ title, children, actions }) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">สำนักสาธารณสุขและสิ่งแวดล้อม</div>
        <h1>{title}</h1>
        <p>{children}</p>
      </div>
      {actions}
    </div>
  );
}
export function DataState({ resource, children }) {
  return resource.error ? (
    <div className="notice error" role="alert">
      {resource.error} <Button onClick={resource.reload}>ลองใหม่</Button>
    </div>
  ) : resource.data ? (
    children(resource.data)
  ) : (
    <p role="status">กำลังโหลดข้อมูล…</p>
  );
}
export function Dialog({ title, children, onClose }) {
  const ref = React.useRef(),
    id = React.useId(),
    close = React.useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement,
      overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    const key = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close.current();
      }
      if (e.key === "Tab") {
        const nodes = [
          ...ref.current.querySelectorAll(
            "button,input,select,textarea,a[href]",
          ),
        ].filter((n) => !n.disabled && n.getClientRects().length);
        const first = nodes[0],
          last = nodes.at(-1);
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === ref.current)
        ) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  return createPortal(
    <div className="dialog-backdrop">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className="settings-dialog"
        tabIndex={-1}
        ref={ref}
      >
        <header>
          <h2 id={id}>{title}</h2>
          <button type="button" onClick={onClose} aria-label="ปิดหน้าต่าง">
            ×
          </button>
        </header>
        {children}
      </section>
    </div>,
    document.body,
  );
}
