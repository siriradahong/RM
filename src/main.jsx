import { metricUnits } from "../shared/metric-units";
import {
  Workspace,
  AccountTools,
  NotificationButton,
  ScopeAdmin,
  OrganizationHistory,
  RoleApprovals,
  ActivityScope,
  AISuggestion,
  LineRegistration,
  LineProcessingStatus,
} from "./scope-workspace";
import DashboardView from "./dashboard";
import ActivityCalendar from "./calendar";
import DuplicateReview from "./duplicate-review";
import TemplatesAdmin from "./templates";
import LocalExtraction, { fillEmptyFromExtraction } from "./extraction";
import ReadingStatus from "./reading-status";
import ReportDrafts from "./report-drafts";
import Reports from "./reports";
import Projects from "./projects";
import ScheduleCalendar from "./schedule-calendar";
import React, {
  useState,
  useEffect,
  useRef,
  createContext,
  useContext,
} from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard,
  FolderOpen,
  Upload,
  Newspaper,
  Users,
  Settings,
  History,
  LogOut,
  Menu,
  X,
  ChevronRight,
  Plus,
  Search,
  ArrowRight,
  FileText,
  Check,
  Clock,
  Building2,
  ShieldCheck,
  Activity,
  Download,
  Eye,
  Save,
  Link,
  Image,
  AlertCircle,
  RefreshCw,
  KeyRound,
  FileUp,
  Inbox,
  ChevronDown,
  CheckCircle2,
  CalendarDays,
  ArrowLeft,
} from "lucide-react";
import "@fontsource/noto-sans-thai/400.css";
import "@fontsource/noto-sans-thai/500.css";
import "@fontsource/noto-sans-thai/600.css";
import "@fontsource/noto-sans-thai/700.css";
import "./styles.css";
import { api, setCsrf, query, fileUrl } from "./api";
import { UnitOptions, WorkOptions } from "./organization";

const Context = createContext();
const useApp = () => useContext(Context);
const roleNames = {
  staff: "เจ้าหน้าที่ปฏิบัติงาน",
  head: "หัวหน้าฝ่าย",
  center_head: "หัวหน้าศูนย์",
  executive: "ผู้บริหารสำนัก",
  pr: "เจ้าหน้าที่ประชาสัมพันธ์",
  admin: "ผู้ดูแลระบบ",
};
const hasHeadScope = (user, unitId) =>
  user.roles.includes("head") && user.scopes.includes(Number(unitId));
const staffOnly = (user) =>
  user.roles.includes("staff") && !user.roles.includes("head");
const assignedWorkReady = (user, meta) =>
  !!meta.works.find(
    (w) => w.id === user.work_id && w.unit_id === user.unit_id && w.active,
  ) && !!meta.units.find((u) => u.id === user.unit_id && u.active);
function AssignmentFields({ unitId, workId, historical = false }) {
  const { meta } = useApp();
  return (
    <div className="assignment-fields">
      <div className="form-row">
        <Field label="ฝ่าย/กลุ่มงาน">
          <input
            readOnly
            value={
              meta.units.find((u) => u.id === Number(unitId))?.name ||
              "ยังไม่ได้กำหนดฝ่าย"
            }
          />
        </Field>
        <Field label="งานที่รับผิดชอบ">
          <input
            readOnly
            value={
              meta.works.find((w) => w.id === Number(workId))?.name ||
              (historical
                ? "ยังไม่ระบุงานในรายการเดิม"
                : "รอผู้ดูแลระบบกำหนดงาน")
            }
          />
        </Field>
      </div>
      <small className="muted">
        {historical
          ? "ฝ่ายและงานตามข้อมูลที่บันทึกไว้ในรายการนี้"
          : "ผู้ดูแลระบบกำหนดให้พนักงาน 1 ฝ่าย และ 1 งาน"}
      </small>
    </div>
  );
}
const today = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
const fmt = (v, time = false) =>
  v
    ? new Intl.DateTimeFormat("th-TH", {
        dateStyle: "medium",
        ...(time ? { timeStyle: "short" } : {}),
      }).format(new Date(v))
    : "ไม่พบข้อมูล";
const num = (v) =>
  Number(v).toLocaleString("th-TH", { maximumFractionDigits: 2 });
const bytes = (v) =>
  v > 1048576 ? (v / 1048576).toFixed(1) + " MB" : Math.ceil(v / 1024) + " KB";
function Button({
  children,
  icon: Icon,
  primary = false,
  className = "",
  ...props
}) {
  return (
    <button
      className={`button ${primary ? "primary" : ""} ${className}`}
      {...props}
    >
      {Icon && <Icon size={18} />}
      <span>{children}</span>
    </button>
  );
}
function Badge({ status, children }) {
  return (
    <span className={`badge ${status || ""}`}>
      {status === "ready" || status === "published" ? (
        <Check size={13} />
      ) : status === "pending" ? (
        <Clock size={13} />
      ) : null}
      {children ||
        {
          ready: "พร้อมสรุป",
          pending: "ตรวจข้อมูลที่อ่านได้",
          duplicate: "ซ้ำ ไม่รวมยอด",
          draft: "ฉบับร่าง",
          published: "เผยแพร่แล้ว",
          sent: "LINE รับคำขอแล้ว",
          failed: "ส่ง LINE ไม่สำเร็จ",
          not_sent: "ยังไม่ส่ง LINE",
          sending: "กำลังส่ง LINE",
        }[status] ||
        status}
    </span>
  );
}
function Notice({ children, error = false }) {
  return (
    <div
      className={`notice ${error ? "error" : ""}`}
      role={error ? "alert" : undefined}
    >
      <AlertCircle size={18} />
      <div>{children}</div>
    </div>
  );
}
function Empty({ title = "ยังไม่มีข้อมูล", children, action }) {
  return (
    <div className="empty">
      <FolderOpen size={40} />
      <h3>{title}</h3>
      <p>{children || "ข้อมูลที่บันทึกในระบบจะแสดงที่นี่"}</p>
      {action}
    </div>
  );
}
function Loading() {
  return (
    <div className="loading" role="status">
      <span className="spinner" />
      กำลังโหลดข้อมูล…
    </div>
  );
}
function Header({ title, description, action }) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">สำนักสาธารณสุขและสิ่งแวดล้อม</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
function Tabs({ items, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {items.map(([key, title]) => (
        <button
          key={key}
          role="tab"
          aria-selected={value === key}
          className={value === key ? "selected" : ""}
          onClick={() => onChange(key)}
        >
          {title}
        </button>
      ))}
    </div>
  );
}
function Field({ label, children, wide = false }) {
  const fieldId = React.useId();
  const direct =
    React.isValidElement(children) &&
    ["input", "select", "textarea"].includes(children.type);
  return (
    <label
      htmlFor={direct ? fieldId : undefined}
      className={`field ${wide ? "wide" : ""}`}
    >
      <span id={fieldId + "-label"}>{label}</span>
      {direct
        ? React.cloneElement(children, {
            id: fieldId,
            "aria-labelledby": fieldId + "-label",
          })
        : children}
    </label>
  );
}
function Pager({ data, onPage }) {
  return (
    <div className="pager">
      <span>
        {num(data.total)} รายการ · หน้า {data.page} /{" "}
        {Math.max(1, Math.ceil(data.total / data.limit))}
      </span>
      <div>
        <Button disabled={data.page <= 1} onClick={() => onPage(data.page - 1)}>
          ก่อนหน้า
        </Button>
        <Button
          disabled={data.page * data.limit >= data.total}
          onClick={() => onPage(data.page + 1)}
        >
          ถัดไป
        </Button>
      </div>
    </div>
  );
}
function Modal({ title, children, onClose, wide = false }) {
  const ref = useRef();
  useEffect(() => {
    const before = document.activeElement;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    const key = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        let els = [
          ...ref.current.querySelectorAll(
            'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex="0"]',
          ),
        ];
        if (!els.length) return;
        const first = els[0],
          last = els.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = old;
      document.removeEventListener("keydown", key);
      before?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        className={`modal ${wide ? "wide-modal" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
        tabIndex={-1}
      >
        <header>
          <h2>{title}</h2>
          <button className="icon-button" aria-label="ปิด" onClick={onClose}>
            <X />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
function useResource(path) {
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [version, reload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    api(path, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted && e.name !== "AbortError")
          setError(e.message);
      });
    return () => controller.abort();
  }, [path, version]);
  return { data, error, reload: () => reload((v) => v + 1) };
}
function Resource({ resource, children }) {
  if (resource.error)
    return (
      <Notice error>
        {resource.error} <Button onClick={resource.reload}>ลองใหม่</Button>
      </Notice>
    );
  if (!resource.data) return <Loading />;
  return children(resource.data);
}
function App() {
  const [user, setUser] = useState(null),
    [meta, setMeta] = useState(null),
    [loading, setLoading] = useState(true),
    [path, setPath] = useState(location.hash.slice(1) || ""),
    [mobile, setMobile] = useState(false),
    [toast, setToast] = useState(""),
    [account, setAccount] = useState(false);
  const timer = useRef();
  const notify = (t) => {
    setToast(t);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(""), 4500);
  };
  const navigate = (p) => {
    location.hash = p;
    setPath(p);
    setMobile(false);
    window.scrollTo(0, 0);
  };
  const landing = (u) =>
    u.roles.includes("executive")
      ? "dashboard/overview"
      : u.roles.includes("head") ||
          u.roles.includes("center_head") ||
          u.delegated
        ? "dashboard/unit"
        : u.roles.includes("staff")
          ? "dashboard/mine"
          : u.roles.includes("pr")
            ? "news"
            : "admin";
  const refreshMeta = () => api("/meta").then(setMeta);
  useEffect(() => {
    const hash = () => setPath(location.hash.slice(1));
    const expired = () => {
      setUser(null);
      setMeta(null);
      setCsrf("");
      notify("เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง");
    };
    window.addEventListener("hashchange", hash);
    window.addEventListener("session-expired", expired);
    api("/auth/me")
      .then(async (r) => {
        setCsrf(r.csrf);
        setUser(r.user);
        await refreshMeta();
        if (!location.hash) navigate(landing(r.user));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => {
      window.removeEventListener("hashchange", hash);
      window.removeEventListener("session-expired", expired);
    };
  }, []);
  async function authenticated(r) {
    setCsrf(r.csrf);
    setUser(r.user);
    await refreshMeta();
    navigate(landing(r.user));
  }
  async function logout() {
    try {
      await api("/auth/logout", { method: "POST" });
      setUser(null);
      setMeta(null);
      setCsrf("");
      setAccount(false);
      location.hash = "";
    } catch (e) {
      notify(e.message);
    }
  }
  if (loading) return <Loading />;
  if (!user)
    return path.startsWith("line-register") ? (
      <LineRegistration onLogin={authenticated} />
    ) : (
      <Login onLogin={authenticated} />
    );
  if (!meta) return <Loading />;
  const canWrite =
      user.delegated ||
      user.roles.some((r) => ["staff", "head", "center_head"].includes(r)),
    isPr = user.roles.includes("pr"),
    isAdmin = user.roles.includes("admin");
  const canReport =
    user.delegated ||
    user.roles.some((r) =>
      ["staff", "head", "center_head", "executive"].includes(r),
    );
  const current = path.split("/")[0],
    view = path.split("/")[1];
  const menu = [
    ...(canWrite
      ? [
          ["inbox", "รายงานจาก LINE", Inbox],
          ["import", "เขียนรายงาน", FileText],
        ]
      : []),
    ...(canReport
      ? [
          ["dashboard/mine", "แดชบอร์ดของฉัน", LayoutDashboard],
          ["projects", "ติดตามโครงการ", CalendarDays],
          ["calendar", "ปฏิทิน", CalendarDays],
        ]
      : []),
    ...(user.delegated ||
    user.roles.some((r) => ["head", "center_head"].includes(r))
      ? [["dashboard/unit", "แดชบอร์ดหน่วยงาน", Users]]
      : []),
    ...(user.roles.includes("executive")
      ? [["dashboard/overview", "แดชบอร์ดสำนัก", Building2]]
      : []),
    ["feed", "ฟีดข่าวภายใน", Newspaper],
    ["library", "คลังข้อมูล", FolderOpen],
    ...(canReport ? [["reports", "รายงานสรุป", FileText]] : []),
    ["workspace", "พื้นที่งานของฉัน", Clock],
    ...(isAdmin ? [["admin", "ดูแลระบบ", Settings]] : []),
  ];
  const activeMenu = (p) =>
    p.includes("/")
      ? path === p
      : current === p ||
        (p === "reports" && current === "drafts") ||
        (p === "feed" && current === "news") ||
        (p === "admin" && current === "audit");
  const requestedDashboard = view || landing(user).split("/")[1];
  const dashboardMode =
    requestedDashboard === "overview" && user.roles.includes("executive")
      ? "overview"
      : requestedDashboard === "unit" &&
          (user.delegated ||
            user.roles.some((r) => ["head", "center_head"].includes(r)))
        ? "unit"
        : "mine";
  const ctx = {
    user,
    meta,
    navigate,
    notify,
    refreshMeta,
    canWrite,
    isPr,
    isAdmin,
  };
  let page;
  if ((current === "dashboard" || !current) && canReport)
    page = (
      <DashboardView
        key={dashboardMode}
        mode={dashboardMode}
        user={user}
        meta={meta}
        navigate={navigate}
        canWrite={canWrite}
      />
    );
  else if (current === "reports" && canReport)
    page = <Reports user={user} meta={meta} navigate={navigate} />;
  else if (current === "drafts" && canReport)
    page = (
      <ReportDrafts id={view} user={user} meta={meta} navigate={navigate} />
    );
  else if (current === "projects" && canReport)
    page = (
      <Projects
        user={user}
        meta={meta}
        navigate={navigate}
        notify={notify}
        projectId={view}
      />
    );
  else if (current === "calendar" && canReport)
    page = <ScheduleCalendar user={user} meta={meta} navigate={navigate} />;
  else if (current === "workspace")
    page = (
      <Workspace
        view={view}
        detailId={path.split("/")[2]}
        user={user}
        meta={meta}
        navigate={navigate}
      />
    );
  else if (current === "library") page = <Library />;
  else if (current === "activity") page = <ActivityEditor id={view} />;
  else if (current === "import" && canWrite) page = <ImportPage />;
  else if (current === "inbox" && canWrite) page = <LineInbox />;
  else if (current === "feed") page = <Feed />;
  else if (current === "news" && isPr)
    page = view ? <NewsEditor id={view} /> : <NewsManager />;
  else if (current === "admin" && isAdmin) page = <Admin tab={view} />;
  else if (current === "audit" && isAdmin) page = <Audit />;
  else
    page = (
      <Empty
        title="ไม่มีสิทธิ์เข้าถึงหน้านี้"
        action={
          <Button onClick={() => navigate(landing(user))}>กลับหน้าหลัก</Button>
        }
      />
    );
  return (
    <Context.Provider value={ctx}>
      <a
        href="#main-content"
        className="skip-link"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main-content").focus();
        }}
      >
        ข้ามไปยังเนื้อหา
      </a>
      {mobile && (
        <button
          className="nav-scrim"
          aria-label="ปิดเมนู"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <a className="brand" href={"#" + landing(user)}>
          <img src="/municipality-seal.png" alt="ตราเทศบาลนครขอนแก่น" />
          <div>
            <strong>เทศบาลนครขอนแก่น</strong>
            <span>KHON KAEN MUNICIPALITY</span>
          </div>
        </a>
        <div className="workspace">
          <span className="workspace-symbol">
            <Activity size={22} />
          </span>
          <div>
            <b>ระบบบูรณาการข้อมูล</b>
            <small>และสรุปผลการปฏิบัติงาน</small>
          </div>
        </div>
        <div className="nav-label">พื้นที่การทำงาน</div>
        <nav>
          {menu.map(([p, title, Icon]) => (
            <button
              key={p}
              className={activeMenu(p) ? "active" : ""}
              aria-current={activeMenu(p) ? "page" : undefined}
              onClick={() => navigate(p)}
            >
              <Icon size={20} />
              <span>{title}</span>
              {activeMenu(p) && <ChevronRight size={15} />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <a href="https://kkmuni.go.th/" target="_blank" rel="noreferrer">
            <Building2 size={18} />
            เว็บไซต์เทศบาล
            <ArrowRight size={15} />
          </a>
          <span>
            <i /> ข้อมูลจากฐานข้อมูลหน่วยงาน
          </span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon-button mobile-toggle"
            aria-label="เปิดเมนู"
            onClick={() => setMobile(!mobile)}
          >
            <Menu />
          </button>
          <div className="breadcrumb">
            พื้นที่การทำงาน <ChevronRight size={14} />{" "}
            <b>
              {current === "drafts"
                ? "รายงานสรุป"
                : current === "inbox"
                  ? "เพิ่มข้อมูล / รับจาก LINE"
                  : current === "news"
                    ? "ฟีดข่าวภายใน / จัดการข่าว"
                    : current === "audit"
                      ? "ดูแลระบบ / ประวัติการแก้ไข"
                      : menu.find((x) => activeMenu(x[0]))?.[1] ||
                        "รายละเอียดข้อมูล"}
            </b>
          </div>
          <NotificationButton navigate={navigate} />
          <button className="profile" onClick={() => setAccount(true)}>
            <span className="avatar">{user.name.slice(0, 1)}</span>
            <span>
              <strong>{user.name}</strong>
              <small>
                {meta.units.find((u) => u.id === user.unit_id)?.name ||
                  "ผู้ดูแลระบบส่วนกลาง"}
              </small>
            </span>
            <ChevronDown size={15} />
          </button>
        </header>
        <main className="content" id="main-content" tabIndex={-1}>
          {meta.demo?.activityCount > 0 && (
            <div className="demo-notice" role="note">
              <span>ข้อมูลสาธิต</span> รายการที่ขึ้นต้น [สาธิต]
              เป็นตัวอย่างสมมติ และถูกรวมในตัวเลขสรุปด้วย
            </div>
          )}
          {page}
          <footer>
            สำนักสาธารณสุขและสิ่งแวดล้อม เทศบาลนครขอนแก่น
            <span>ระบบบูรณาการข้อมูลและสรุปผลการปฏิบัติงาน</span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={19} />
          {toast}
        </div>
      )}
      {account && (
        <Modal title="บัญชีของฉัน" onClose={() => setAccount(false)}>
          <h3>{user.name}</h3>
          <div className="role-list">
            {user.roles.map((r) => (
              <Badge key={r}>{roleNames[r]}</Badge>
            ))}
          </div>
          <AccountTools user={user} meta={meta} navigate={navigate} />
          <PasswordForm
            onChanged={() => {
              setUser(null);
              setAccount(false);
              notify("เปลี่ยนรหัสผ่านแล้ว กรุณาเข้าสู่ระบบใหม่");
            }}
          />
          <div className="modal-actions">
            <Button icon={LogOut} onClick={logout}>
              ออกจากระบบ
            </Button>
          </div>
        </Modal>
      )}
    </Context.Provider>
  );
}
function Login({ onLogin }) {
  const line = useResource("/auth/line/status");
  const [show, setShow] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const f = new FormData(e.currentTarget);
      await onLogin(
        await api("/auth/login", {
          method: "POST",
          body: Object.fromEntries(f),
        }),
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login">
      <section className="login-brand">
        <div className="login-identity">
          <img src="/municipality-seal.png" alt="ตราเทศบาลนครขอนแก่น" />
          <div>
            เทศบาลนครขอนแก่น<small>KHON KAEN MUNICIPALITY</small>
          </div>
        </div>
        <div className="login-message">
          <span className="eyebrow">PUBLIC HEALTH & ENVIRONMENT</span>
          <h1>
            เชื่อมโยงข้อมูล
            <br />
            เพื่อสุขภาวะที่ดี
            <br />
            ของเมืองขอนแก่น<span>.</span>
          </h1>
          <p>
            รวบรวมข้อมูลการทำงาน ค้นหาหลักฐาน
            <br />
            และสรุปผลการดำเนินงานในพื้นที่เดียว
          </p>
          <div className="login-pills">
            <span>
              <ShieldCheck size={16} />
              สิทธิ์ตามบทบาท
            </span>
            <span>
              <FolderOpen size={16} />
              ข้อมูลส่วนกลาง
            </span>
          </div>
        </div>
        <small>สำนักสาธารณสุขและสิ่งแวดล้อม</small>
      </section>
      <section className="login-panel">
        <div className="login-form">
          <span className="section-kicker">ยินดีต้อนรับ</span>
          <h2>เข้าสู่ระบบ</h2>
          <p>ระบบบูรณาการข้อมูลและสรุปผลการปฏิบัติงาน</p>
          <form onSubmit={submit} className="form">
            <Field label="ชื่อผู้ใช้">
              <input
                name="username"
                autoComplete="username"
                placeholder="กรอกชื่อผู้ใช้"
                required
                maxLength={60}
              />
            </Field>
            <Field label="รหัสผ่าน">
              <div className="password-input">
                <input
                  name="password"
                  type={show ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="กรอกรหัสผ่าน"
                  required
                  maxLength={128}
                />
                <button
                  type="button"
                  aria-label={show ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
                  onClick={() => setShow(!show)}
                >
                  <Eye size={20} />
                </button>
              </div>
            </Field>
            {error && <Notice error>{error}</Notice>}
            <Button
              primary
              disabled={busy}
              icon={busy ? RefreshCw : ArrowRight}
            >
              {busy ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}
            </Button>
          </form>
          {line.data?.configured ? (
            <a className="button line-login" href="/api/auth/line/start">
              เข้าสู่ระบบด้วย LINE
            </a>
          ) : (
            <small className="muted">
              LINE Login ยังไม่ได้ตั้งค่า ใช้บัญชีของหน่วยงานด้านบน
            </small>
          )}
          <div className="login-help">
            <ShieldCheck size={20} />
            <span>
              สำหรับเจ้าหน้าที่ภายในหน่วยงาน
              <br />
              <small>
                หากยังไม่มีบัญชีหรือลืมรหัสผ่าน กรุณาติดต่อผู้ดูแลระบบ
              </small>
            </span>
          </div>
          <a
            className="text-link"
            href="https://kkmuni.go.th/"
            target="_blank"
            rel="noreferrer"
          >
            กลับเว็บไซต์เทศบาล <ArrowRight size={15} />
          </a>
        </div>
      </section>
    </div>
  );
}
function PasswordForm({ onChanged }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await api("/auth/password", {
            method: "POST",
            body: Object.fromEntries(new FormData(e.currentTarget)),
          });
          onChanged();
        } catch (e) {
          setError(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h4>เปลี่ยนรหัสผ่าน</h4>
      <Field label="รหัสผ่านปัจจุบัน">
        <input
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>
      <Field label="รหัสผ่านใหม่ (อย่างน้อย 12 ตัวอักษร)">
        <input
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
        />
      </Field>
      {error && <Notice error>{error}</Notice>}
      <Button disabled={busy} icon={KeyRound}>
        เปลี่ยนรหัสผ่าน
      </Button>
    </form>
  );
}
function Filters({
  value,
  onChange,
  search = true,
  scope = true,
  dates = true,
  attachments = false,
}) {
  const { meta } = useApp();
  const set = (k, v) => onChange({ ...value, [k]: v, page: 1 });
  return (
    <div className="filters">
      {search && (
        <label className="search-field">
          <Search size={19} />
          <input
            aria-label="ค้นหา"
            placeholder="ค้นหาชื่อเรื่อง หรือคำสำคัญ"
            value={value.q || ""}
            onChange={(e) => set("q", e.target.value)}
          />
        </label>
      )}
      <select
        aria-label="หน่วยงาน"
        value={value.unit || ""}
        onChange={(e) => set("unit", e.target.value)}
      >
        <option value="">ทุกหน่วยงาน</option>
        <UnitOptions units={meta.units} />
      </select>
      {dates && (
        <>
          <label className="date-filter">
            ตั้งแต่
            <input
              type="date"
              value={value.from || ""}
              onChange={(e) => set("from", e.target.value)}
            />
          </label>
          <label className="date-filter">
            ถึง
            <input
              type="date"
              value={value.to || ""}
              onChange={(e) => set("to", e.target.value)}
            />
          </label>
        </>
      )}
      {attachments && (
        <select
          aria-label="ไฟล์แนบของรายงาน"
          value={value.attachments || ""}
          onChange={(e) => set("attachments", e.target.value)}
        >
          <option value="">ไฟล์แนบทุกแบบ</option>
          <option value="image">มีรูปภาพ</option>
          <option value="file">มีไฟล์เอกสาร</option>
          <option value="none">ไม่มีไฟล์แนบ</option>
        </select>
      )}
      {scope && (
        <select
          aria-label="ขอบเขตข้อมูล"
          value={value.mine || ""}
          onChange={(e) => set("mine", e.target.value)}
        >
          <option value="">ข้อมูลตามสิทธิ์ของฉัน</option>
          <option value="1">รายงานของฉัน</option>
        </select>
      )}
    </div>
  );
}
function WorkTable({ rows }) {
  const { navigate, canWrite } = useApp();
  if (!rows.length)
    return (
      <Empty
        title="ไม่พบรายการงาน"
        children={
          canWrite
            ? "ลองเปลี่ยนตัวกรอง หรือเพิ่มข้อมูลรายงาน"
            : "ลองเปลี่ยนตัวกรองเพื่อดูรายงานที่บันทึกไว้"
        }
      />
    );
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>ชื่อเรื่อง / วันที่ปฏิบัติงาน</th>
            <th>หน่วยงาน / พื้นที่</th>
            <th>ผลการดำเนินงาน</th>
            <th>แหล่งที่มา</th>
            <th>สถานะ</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <button
                  className="table-link"
                  onClick={() => navigate("activity/" + r.id)}
                >
                  {r.title}
                </button>
                <small>
                  {fmt(r.date)} · {r.category_name || "ไม่ระบุประเภท"}
                </small>
              </td>
              <td>
                {r.unit_name}
                {r.work_name && <small>{r.work_name}</small>}
                <small>{r.area || "ไม่พบข้อมูล"}</small>
              </td>
              <td>
                {r.metrics.length
                  ? r.metrics.map((m, i) => (
                      <small className="result-value" key={i}>
                        {m.label} {num(m.value)} {m.unit}
                      </small>
                    ))
                  : "ไม่พบข้อมูล"}
              </td>
              <td>
                <Badge status={r.source === "line" ? "line" : ""}>
                  {r.source === "line" ? "LINE" : "อัปโหลดผ่านเว็บ"}
                </Badge>
              </td>
              <td>
                <Badge status={r.duplicate_of ? "duplicate" : r.status} />
              </td>
              <td>
                <button
                  className="icon-button"
                  aria-label={"เปิด " + r.title}
                  onClick={() => navigate("activity/" + r.id)}
                >
                  <ChevronRight size={19} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Library() {
  const { navigate, meta, canWrite } = useApp();
  const [tab, setTab] = useState(() => {
    const t = sessionStorage.getItem("rm-library-tab") || "activities";
    sessionStorage.removeItem("rm-library-tab");
    return t;
  });
  const [filters, setFilters] = useState(() => {
    try {
      const f = JSON.parse(sessionStorage.getItem("rm-library-filter") || "{}");
      sessionStorage.removeItem("rm-library-filter");
      return { ...f, page: 1 };
    } catch {
      return { page: 1 };
    }
  });
  const [preview, setPreview] = useState(null);
  const resource = useResource(
    "/" + (tab === "files" ? "files" : "activities") + "?" + query(filters),
  );
  return (
    <>
      <Header
        title="คลังข้อมูล"
        description="ค้นหาเอกสาร รายการงาน และหลักฐานต้นทางที่จัดเก็บไว้ส่วนกลาง"
        action={
          canWrite && (
            <Button primary icon={Plus} onClick={() => navigate("import")}>
              เพิ่มข้อมูล
            </Button>
          )
        }
      />
      <Tabs
        items={[
          ["activities", "รายการงาน"],
          ["files", "ไฟล์และเอกสาร"],
          ["calendar", "ปฏิทินกิจกรรม"],
        ]}
        value={tab}
        onChange={(t) => {
          setTab(t);
          setFilters((f) => ({ ...f, page: 1 }));
        }}
      />
      <Filters
        value={filters}
        onChange={setFilters}
        dates={tab !== "calendar"}
        attachments={tab === "activities"}
      />
      {tab === "activities" && (
        <div className="filters compact">
          <select
            aria-label="ประเภทงาน"
            value={filters.category || ""}
            onChange={(e) =>
              setFilters({ ...filters, category: e.target.value, page: 1 })
            }
          >
            <option value="">ทุกประเภทงาน</option>
            {meta.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            aria-label="สถานะ"
            value={filters.status || ""}
            onChange={(e) =>
              setFilters({ ...filters, status: e.target.value, page: 1 })
            }
          >
            <option value="">ทุกสถานะ</option>
            <option value="ready">พร้อมสรุป</option>
            <option value="pending">ตรวจข้อมูลที่อ่านได้</option>
            <option value="duplicate">ซ้ำ ไม่รวมยอด</option>
          </select>
          <select
            aria-label="แหล่งที่มา"
            value={filters.source || ""}
            onChange={(e) =>
              setFilters({ ...filters, source: e.target.value, page: 1 })
            }
          >
            <option value="">ทุกแหล่งที่มา</option>
            <option value="line">LINE</option>
            <option value="web">อัปโหลดผ่านเว็บ</option>
          </select>
          <Button onClick={() => setFilters({ page: 1 })}>ล้างตัวกรอง</Button>
        </div>
      )}
      {tab === "calendar" ? (
        <ActivityCalendar filters={filters} navigate={navigate} />
      ) : (
        <section className="panel">
          <Resource resource={resource}>
            {(d) => (
              <>
                {tab === "activities" ? (
                  <WorkTable rows={d.items} />
                ) : d.items.length ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>ชื่อไฟล์ / ขนาด</th>
                          <th>หน่วยงาน</th>
                          <th>ผู้นำเข้า</th>
                          <th>วัตถุประสงค์</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {d.items.map((f) => (
                          <tr key={f.id}>
                            <td>
                              <button
                                className="table-link file-link"
                                onClick={() => setPreview(f)}
                              >
                                <FileText size={20} />
                                {f.title}
                              </button>
                              <small>
                                {bytes(f.size)} · {fmt(f.created_at)}
                              </small>
                            </td>
                            <td>{f.unit_name}</td>
                            <td>{f.owner_name}</td>
                            <td>
                              <Badge>
                                {f.purpose === "archive"
                                  ? "ฝากเก็บเพื่ออ้างอิง"
                                  : "หลักฐานกิจกรรม"}
                              </Badge>
                              {f.activity_id && (
                                <button
                                  className="text-link"
                                  onClick={() =>
                                    navigate("activity/" + f.activity_id)
                                  }
                                >
                                  เปิดรายการงาน
                                </button>
                              )}
                            </td>
                            <td>
                              <a
                                className="icon-button"
                                href={fileUrl(f.id, true)}
                                aria-label="ดาวน์โหลด"
                              >
                                <Download size={19} />
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty title="ไม่พบไฟล์และเอกสาร" />
                )}
                <Pager
                  data={d}
                  onPage={(page) => setFilters({ ...filters, page })}
                />
              </>
            )}
          </Resource>
        </section>
      )}
      {preview && (
        <FilePreview file={preview} onClose={() => setPreview(null)} />
      )}
    </>
  );
}
function FilePreview({ file, onClose }) {
  if (file.purged)
    return (
      <Modal title={file.title} onClose={onClose}>
        <Notice>
          ไฟล์ครบอายุเก็บและถูกลบแล้ว ยังคงชื่อรายการและประวัติการจัดเก็บไว้
        </Notice>
      </Modal>
    );
  return (
    <Modal title={file.title || file.original_name} onClose={onClose} wide>
      {file.description && (
        <section className="source-message">
          <h3>ข้อความที่บันทึกไว้</h3>
          <p style={{ whiteSpace: "pre-wrap" }}>{file.description}</p>
        </section>
      )}
      {file.mime.startsWith("image/") ? (
        <img
          className="preview-image"
          src={fileUrl(file.id)}
          alt={file.title}
        />
      ) : file.mime === "application/pdf" ? (
        <iframe
          className="pdf-preview"
          title={file.title}
          src={fileUrl(file.id)}
        />
      ) : file.mime !== "text/plain" ? (
        <Empty title="ดาวน์โหลดเพื่อเปิดในโปรแกรมเอกสาร" />
      ) : null}
      <div className="modal-actions">
        <span className="muted">
          {bytes(file.size)} · {fmt(file.created_at)}
        </span>
        <a className="button primary" href={fileUrl(file.id, true)}>
          <Download size={18} />
          ดาวน์โหลดไฟล์
        </a>
      </div>
    </Modal>
  );
}

function ImportPage() {
  const { user, meta, navigate, notify } = useApp();
  const [text, setText] = useState(() => {
    const draft = sessionStorage.getItem("rm-task-draft") || "";
    sessionStorage.removeItem("rm-task-draft");
    return draft;
  });
  const [files, setFiles] = useState([]);
  const [archive, setArchive] = useState(false),
    [newsRequested, setNewsRequested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [reading, setReading] = useState(false);
  const uploaded = useRef(new Map());
  const intakeKey = useRef(crypto.randomUUID());
  const unit = user.roles.includes("staff")
    ? user.unit_id
    : user.scopes[0] || user.unit_id;
  const work =
    meta.works.find((w) => w.id === user.work_id && w.unit_id === unit)?.id ||
    (user.roles.includes("center_head")
      ? user.work_scopes.find((id) =>
          meta.works.some((w) => w.id === id && w.unit_id === unit && w.active),
        )
      : null) ||
    null;
  const needsAssignment = staffOnly(user) && !assignedWorkReady(user, meta);
  function choose(list) {
    const next = [...files, ...Array.from(list)];
    if (
      next.length > 10 ||
      next.some(
        (f) =>
          f.size > 20 * 1024 * 1024 ||
          !/\.(pdf|docx|xlsx?|png|jpe?g|webp)$/i.test(f.name),
      )
    ) {
      setError(
        "แนบได้สูงสุด 10 ไฟล์ รองรับ PDF, Word, Excel และรูปภาพ ขนาดไม่เกิน 20 MB ต่อไฟล์",
      );
      return;
    }
    setFiles(next);
    setError("");
  }
  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    if (!text.trim() && !files.length) {
      setError("พิมพ์ข้อความหรือแนบไฟล์อย่างน้อยหนึ่งอย่าง");
      return;
    }
    setBusy(true);
    setError("");
    try {
      // This is only a display label from the source, not an extracted activity title.
      const title = (text.trim().split("\n")[0] || files[0].name).slice(0, 300);
      const ids = [];
      for (const file of files) {
        let id = uploaded.current.get(file);
        if (!id) {
          const body = new FormData();
          body.append("file", file);
          body.append("purpose", archive ? "archive" : "evidence");
          body.append("unit_id", unit);
          if (work) body.append("work_id", work);
          body.append("title", file.name.slice(0, 300));
          if (archive) body.append("description", text);
          id = (await api("/files", { method: "POST", body })).id;
          uploaded.current.set(file, id);
        }
        ids.push(id);
        setProgress(ids.length);
      }
      if (archive) {
        if (!files.length) {
          const body = new FormData();
          body.append("purpose", "archive");
          body.append("unit_id", unit);
          if (work) body.append("work_id", work);
          body.append("title", title);
          body.append("description", text);
          await api("/files", { method: "POST", body });
        }
        sessionStorage.setItem("rm-library-tab", "files");
        notify("บันทึกเข้าคลังแล้ว ไม่รวมในสรุปผลงาน");
        navigate("library");
      } else {
        const out = await api("/activities", {
          method: "POST",
          body: {
            title,
            date: null,
            unit_id: Number(unit),
            work_id: work,
            source_text: text,
            intake: true,
            intake_key: intakeKey.current,
            status: "pending",
            news_requested: newsRequested,
            file_ids: ids,
            result: "",
            workers: "",
            metrics: [],
          },
        });
        setReading(true);
        try {
          await api(`/activities/${out.id}/extract`, {
            method: "POST",
            body: { version: out.version },
          });
          notify("อ่านต้นฉบับแล้ว กรุณาตรวจและยืนยันข้อมูล");
        } catch {
          notify("เก็บรายงานแล้ว กดอ่านต้นฉบับอีกครั้งในหน้าตรวจข้อมูลได้");
        }
        setReading(false);
        navigate("activity/" + out.id);
      }
    } catch (e) {
      setError(
        e.message +
          (uploaded.current.size
            ? " — ไฟล์ที่อัปโหลดสำเร็จถูกเก็บแล้ว กดส่งอีกครั้งเพื่อดำเนินการต่อ"
            : ""),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Header
        title="เพิ่มข้อมูล"
        description="ส่งรายงานเหมือนใน LINE พิมพ์ข้อความ แนบไฟล์ หรือส่งทั้งสองอย่างพร้อมกัน"
      />
      <IntakeTabs active="web" />
      <section className="panel import-panel">
        <form className="form" onSubmit={submit}>
          <fieldset disabled={busy || needsAssignment || !unit}>
            <Field label="ข้อความรายงาน">
              <textarea
                rows={6}
                maxLength={20000}
                value={text}
                disabled={uploaded.current.size > 0}
                placeholder="พิมพ์หรือวางรายงานเหมือนที่ส่งใน LINE… หากรายละเอียดอยู่ในไฟล์แล้ว ส่งไฟล์อย่างเดียวได้"
                onChange={(e) => setText(e.target.value)}
              />
            </Field>
            <label
              className="dropzone"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (!busy && !uploaded.current.size)
                  choose(e.dataTransfer.files);
              }}
            >
              <FileUp size={32} />
              <h2>ลากไฟล์มาวาง หรือกดแนบไฟล์</h2>
              <p>
                PDF, Word, Excel หรือรูปภาพ · สูงสุด 10 ไฟล์ · 20 MB ต่อไฟล์
              </p>
              <input
                type="file"
                aria-label="แนบไฟล์"
                multiple
                accept=".pdf,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp"
                disabled={busy || uploaded.current.size > 0}
                onChange={(e) => {
                  choose(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
            <div className="file-list">
              {files.map((f, i) => (
                <div className="file-row" key={i}>
                  <FileText size={20} />
                  <span>
                    {f.name} · {bytes(f.size)}
                  </span>
                  <Button
                    type="button"
                    disabled={uploaded.current.size > 0}
                    onClick={() => setFiles(files.filter((_, j) => j !== i))}
                  >
                    ลบไฟล์
                  </Button>
                </div>
              ))}
            </div>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={archive}
                disabled={uploaded.current.size > 0}
                onChange={(e) => setArchive(e.target.checked)}
              />{" "}
              เก็บไว้ค้นหาเท่านั้น — ไม่รวมในสรุปผลงาน
            </label>
            {!archive && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={newsRequested}
                  onChange={(e) => setNewsRequested(e.target.checked)}
                />
                เสนอเป็นข่าวด้วยหลังยืนยันข้อมูล
              </label>
            )}
            <details className="intake-details">
              <summary>รายละเอียดการบันทึก · {user.name}</summary>
              <p className="muted">
                ฝ่ายรับเรื่อง:{" "}
                {meta.units.find((u) => u.id === unit)?.name || "ยังไม่ระบุ"} ·
                ตรวจฝ่ายเจ้าของรายงานจากต้นฉบับอีกครั้ง
              </p>
              <p>
                {archive
                  ? "เก็บข้อความและไฟล์ไว้ค้นหา ไม่เพิ่มยอดผลงาน"
                  : "เก็บต้นฉบับก่อน แล้วเปิดข้อมูลที่อ่านได้ให้ตรวจยืนยัน รูปที่ส่งพร้อมกันแนบกับรายงานให้อัตโนมัติ"}
              </p>
            </details>
            {error && <Notice error>{error}</Notice>}
            <Button
              primary
              type="submit"
              icon={Upload}
              disabled={busy || (!text.trim() && !files.length)}
            >
              {busy
                ? reading
                  ? "กำลังอ่านข้อความและจัดข้อมูล…"
                  : `กำลังจัดเก็บ ${progress}/${files.length} ไฟล์…`
                : archive
                  ? files.length
                    ? "ฝากไฟล์ไว้ค้นหา"
                    : "บันทึกข้อความไว้ค้นหา"
                  : "ส่งรายงาน"}
            </Button>
          </fieldset>
          {(needsAssignment || !unit) && (
            <Notice error>
              กรุณาให้แอดมินกำหนดฝ่ายและงานของบัญชีก่อนส่งรายงาน
            </Notice>
          )}
        </form>
      </section>
    </>
  );
}

const blankActivity = (user, extra = {}) => ({
  title: "",
  date: "",
  unit_id: user.unit_id || user.scopes[0] || "",
  category_id: "",
  work_id: user.work_id || user.work_scopes?.[0] || "",
  area: "",
  workers: "",
  result: "",
  metrics: [],
  status: "pending",
  file_ids: [],
  inbox_ids: [],
  ...extra,
  ...(staffOnly(user)
    ? { unit_id: user.unit_id || "", work_id: user.work_id || "" }
    : {}),
});
function ActivityEditor({ id }) {
  const { user, meta, navigate, notify, canWrite } = useApp();
  const fresh = id === "new";
  const [form, setForm] = useState(null),
    [record, setRecord] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState(null),
    [evidence, setEvidence] = useState([]),
    [attach, setAttach] = useState(false),
    [addCategory, setAddCategory] = useState(false),
    [editing, setEditing] = useState({}),
    [fieldErrors, setFieldErrors] = useState({}),
    [extraOpen, setExtraOpen] = useState(false);
  const newRef = useRef(null);
  useEffect(() => {
    let alive = true;
    setForm(null);
    setError("");
    setEditing({});
    setFieldErrors({});
    setExtraOpen(false);
    if (fresh) {
      let extra = {};
      try {
        extra = JSON.parse(sessionStorage.getItem("rm-new-evidence") || "{}");
      } catch {}
      newRef.current = extra;
      setForm(
        blankActivity(user, {
          ...extra,
          ...(extra.file_ids?.length || extra.inbox_ids?.length
            ? { date: "" }
            : {}),
        }),
      );
      if (extra.file_ids?.length)
        api("/files?mine=1&purpose=evidence&unlinked=1&limit=100")
          .then(
            (d) =>
              alive &&
              setEvidence(d.items.filter((f) => extra.file_ids.includes(f.id))),
          )
          .catch((e) => setError(e.message));
    } else
      api("/activities/" + id)
        .then((r) => {
          if (alive) {
            setRecord(r);
            setForm({
              ...fillEmptyFromExtraction(r, r.extraction),
              file_ids: [],
              inbox_ids: [],
            });
            setEvidence(r.files);
          }
        })
        .catch((e) => setError(e.message));
    return () => {
      alive = false;
    };
  }, [id]);
  const editable = fresh
    ? canWrite
    : record?.can_edit && (!record.period_lock || record.amendment_allowed);
  const canChangeAssignment =
    ((user.roles.includes("head") || user.delegated) &&
      (fresh ||
        hasHeadScope(user, record?.unit_id) ||
        user.scopes.includes(record?.unit_id))) ||
    (user.roles.includes("center_head") &&
      (fresh || user.work_scopes.includes(record?.work_id)));
  const lockedWork =
    user.roles.includes("staff") && !hasHeadScope(user, form?.unit_id);
  const needsAssignment = fresh && lockedWork && !assignedWorkReady(user, meta);
  const change = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setFieldErrors((errors) => ({ ...errors, [key]: "" }));
  };
  function edit(key) {
    setEditing((e) => ({ ...e, [key]: true }));
    if (["category_id", "area", "workers"].includes(key)) setExtraOpen(true);
  }
  async function save(status) {
    if (busy || !editable) return;
    const missing = {};
    if (!form.title.trim()) missing.title = "กรุณาระบุชื่อกิจกรรม";
    if (status === "ready") {
      for (const [key, label] of [
        ["date", "วันที่กิจกรรม"],
        ["category_id", "ประเภทงาน"],
        ["area", "พื้นที่"],
        ["workers", "ผู้ปฏิบัติงานจากต้นฉบับ"],
        ["result", "ผลการดำเนินงาน"],
      ])
        if (!String(form[key] || "").trim())
          missing[key] = "กรุณายืนยัน" + label;
    }
    if (
      form.metrics.some(
        (m) =>
          !m.label.trim() ||
          m.value === "" ||
          !Number.isFinite(Number(m.value)) ||
          Number(m.value) < 0,
      )
    )
      missing.metrics =
        "กรุณาระบุชื่อผลและจำนวนที่ถูกต้อง หรือเอารายการที่ยังไม่ทราบออก";
    setFieldErrors(missing);
    if (Object.keys(missing).length) {
      setError("");
      const key = Object.keys(missing)[0];
      edit(key);
      requestAnimationFrame(() =>
        document
          .getElementById("review-" + key)
          ?.scrollIntoView({ behavior: "smooth", block: "center" }),
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const out = await api("/activities" + (fresh ? "" : "/" + id), {
        method: fresh ? "POST" : "PUT",
        body: {
          ...form,
          status,
          intake: Boolean(form.intake),
          intake_key: form.intake_key || undefined,
          unit_id: Number(form.unit_id),
          category_id: form.category_id ? Number(form.category_id) : null,
          work_id: form.work_id ? Number(form.work_id) : null,
          date: form.date || null,
          metrics: form.metrics.map((m) => ({ ...m, value: Number(m.value) })),
        },
      });
      sessionStorage.removeItem("rm-new-evidence");
      notify(
        status === "ready"
          ? "เสร็จแล้ว — ยืนยันข้อมูลพร้อมสรุป"
          : "บันทึกแล้ว — รอยืนยันข้อมูล",
      );
      if (fresh) navigate("activity/" + out.id);
      else {
        const updated = await api("/activities/" + id);
        setRecord(updated);
        setForm({ ...updated, file_ids: [], inbox_ids: [] });
        setEvidence(updated.files);
        setEditing({});
        setFieldErrors({});
      }
    } catch (e) {
      setError(e.message + (e.details ? " · " + e.details.join(" / ") : ""));
    } finally {
      setBusy(false);
    }
  }
  if (!form) return error ? <Notice error>{error}</Notice> : <Loading />;
  const row = (key, label, value, controls, allowed = editable) => (
    <ReviewItem
      key={key}
      field={key}
      label={label}
      value={value}
      editing={Boolean(editing[key])}
      editable={allowed && !needsAssignment}
      busy={busy}
      error={fieldErrors[key]}
      onEdit={() => edit(key)}
      onDone={() => setEditing((e) => ({ ...e, [key]: false }))}
    >
      {controls}
    </ReviewItem>
  );
  const textInput = (key, label, multiline = false) => (
    <Field label={label}>
      {multiline ? (
        <textarea
          rows={3}
          maxLength={key === "result" ? 10000 : 2000}
          value={form[key]}
          onChange={(e) => change(key, e.target.value)}
        />
      ) : (
        <input
          maxLength={300}
          value={form[key]}
          onChange={(e) => change(key, e.target.value)}
        />
      )}
    </Field>
  );
  return (
    <>
      <Header
        title="ตรวจข้อมูลรายงาน"
        description="อ่านสรุปและแก้ไขเฉพาะข้อมูลที่ต้องการ"
        action={
          <Button icon={ArrowLeft} onClick={() => navigate("library")}>
            กลับคลังข้อมูล
          </Button>
        }
      />
      <div className="detail-status">
        <Badge
          status={
            record?.duplicate_of ? "duplicate" : record?.status || form.status
          }
        >
          {record?.duplicate_of
            ? "รายการซ้ำ · ไม่รวมยอด"
            : (record?.status || form.status) === "ready"
              ? "เสร็จแล้ว · พร้อมสรุป"
              : "ตรวจข้อมูลที่อ่านได้"}
        </Badge>
        <span>
          {editable ? "แก้ไขได้ตามสิทธิ์" : "อ่านอย่างเดียว"} · ผู้ส่ง:{" "}
          {record?.owner_name || user.name}
        </span>
      </div>
      {record && (
        <ActivityScope
          record={record}
          user={user}
          meta={meta}
          refresh={async () => {
            const r = await api("/activities/" + id);
            setRecord(r);
            setForm({ ...r, file_ids: [], inbox_ids: [] });
            setEvidence(r.files);
          }}
        />
      )}
      {record?.locked_by_project && (
        <Notice>
          รายงานนี้ใช้ตรวจรับงานแล้ว หากต้องแก้ไข
          ให้หัวหน้าเปิดโครงการและส่งงานกลับก่อน
        </Notice>
      )}
      {record && (
        <DuplicateReview
          key={"duplicate:" + record.id + ":" + record.version}
          record={{ ...record, can_edit: editable }}
          navigate={navigate}
          onChanged={async () => {
            const updated = await api("/activities/" + id);
            setRecord(updated);
            setForm((f) => ({
              ...f,
              duplicate_of: updated.duplicate_of,
              duplicate_reason: updated.duplicate_reason,
              version: updated.version,
            }));
            setEvidence(updated.files);
            notify(
              updated.duplicate_of
                ? "ยืนยันรายการซ้ำแล้ว ไม่รวมยอด"
                : "ยกเลิกการระบุว่าซ้ำแล้ว",
            );
          }}
        />
      )}
      {record && (record.status === "pending" || record.extraction) && (
        <LocalExtraction
          key={"extraction:" + record.id + ":" + record.version}
          record={record}
          onApply={(e) => setForm((f) => fillEmptyFromExtraction(f, e))}
        />
      )}
      <div className="review-layout">
        <section className="panel review-main">
          <h2>สรุปข้อมูล</h2>
          {needsAssignment && (
            <Notice error>กรุณาให้แอดมินกำหนดฝ่ายและงานก่อนสร้างรายงาน</Notice>
          )}
          {row(
            "title",
            "ชื่อกิจกรรม",
            form.title,
            textInput("title", "ชื่อเรื่อง *"),
          )}
          {row(
            "date",
            "วันที่",
            form.date ? fmt(form.date) : "",
            <Field label="วันที่ปฏิบัติงาน">
              <input
                type="date"
                value={form.date || ""}
                onChange={(e) => change("date", e.target.value)}
              />
            </Field>,
          )}
          {row(
            "assignment",
            "ฝ่าย/งาน",
            [
              meta.units.find((u) => u.id === Number(form.unit_id))?.name,
              meta.works.find((w) => w.id === Number(form.work_id))?.name,
            ]
              .filter(Boolean)
              .join(" / "),
            <>
              {canChangeAssignment && (
                <Field label="ฝ่าย/กลุ่มงาน *">
                  <select
                    value={form.unit_id}
                    required
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        unit_id: Number(e.target.value),
                        work_id:
                          Number(e.target.value) === user.unit_id
                            ? user.work_id || ""
                            : "",
                      }))
                    }
                  >
                    <option value="">เลือกฝ่าย/กลุ่มงาน</option>
                    <UnitOptions
                      units={meta.units}
                      allowed={meta.units.filter(
                        (u) =>
                          u.id === form.unit_id ||
                          (u.active &&
                            (!editable ||
                              (user.roles.includes("staff") &&
                                u.id === user.unit_id) ||
                              ((user.roles.includes("head") ||
                                user.delegated) &&
                                user.scopes.includes(u.id)) ||
                              (user.roles.includes("center_head") &&
                                u.id === user.unit_id))),
                      )}
                    />
                  </select>
                </Field>
              )}

              {!canChangeAssignment ? (
                <AssignmentFields
                  unitId={form.unit_id}
                  workId={form.work_id}
                  historical={!fresh}
                />
              ) : (
                <Field label="งานตามฝ่าย/กลุ่มงาน">
                  {lockedWork ? (
                    <input
                      readOnly
                      value={
                        meta.works.find((w) => w.id === user.work_id)?.name ||
                        "รอผู้ดูแลระบบกำหนดงาน"
                      }
                    />
                  ) : (
                    <select
                      value={form.work_id || ""}
                      onChange={(e) => change("work_id", e.target.value)}
                      disabled={!form.unit_id}
                    >
                      <option value="">ยังไม่ระบุงาน</option>
                      <WorkOptions
                        works={meta.works}
                        unitId={form.unit_id}
                        selected={form.work_id}
                      />
                    </select>
                  )}
                </Field>
              )}
            </>,
            editable && canChangeAssignment,
          )}
          {row(
            "result",
            "ผลการดำเนินงาน",
            form.result,
            textInput("result", "ผลการดำเนินงาน", true),
          )}
          {row(
            "metrics",
            "ตัวเลขและหน่วยนับ",
            form.metrics.length
              ? form.metrics
                  .map((m) => `${m.label} ${m.value} ${m.unit}`)
                  .join(" · ")
              : "ยังไม่มีตัวเลขที่ยืนยัน",
            <>
              <div className="form-section-title">
                <h3>ตัวเลขและหน่วยนับ</h3>
                <Button
                  type="button"
                  icon={Plus}
                  onClick={() =>
                    change("metrics", [
                      ...form.metrics,
                      { label: "", value: 0, unit: "คน" },
                    ])
                  }
                >
                  เพิ่มผล
                </Button>
              </div>
              {form.metrics.map((m, i) => (
                <div className="metric-row" key={i}>
                  <input
                    aria-label={"ชื่อผล " + (i + 1)}
                    placeholder="เช่น ผู้เข้าร่วม"
                    required
                    value={m.label}
                    onChange={(e) =>
                      change(
                        "metrics",
                        form.metrics.map((x, j) =>
                          j === i ? { ...x, label: e.target.value } : x,
                        ),
                      )
                    }
                  />
                  <input
                    aria-label={"จำนวน " + (i + 1)}
                    type="number"
                    min="0"
                    step="any"
                    required
                    value={m.value}
                    onChange={(e) =>
                      change(
                        "metrics",
                        form.metrics.map((x, j) =>
                          j === i ? { ...x, value: e.target.value } : x,
                        ),
                      )
                    }
                  />
                  <select
                    aria-label={"หน่วยนับ " + (i + 1)}
                    value={m.unit}
                    onChange={(e) =>
                      change(
                        "metrics",
                        form.metrics.map((x, j) =>
                          j === i ? { ...x, unit: e.target.value } : x,
                        ),
                      )
                    }
                  >
                    {metricUnits.map((u) => (
                      <option key={u}>{u}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="ลบผล"
                    onClick={() =>
                      change(
                        "metrics",
                        form.metrics.filter((_, j) => j !== i),
                      )
                    }
                  >
                    <X size={17} />
                  </button>
                </div>
              ))}
            </>,
          )}
          <details
            className="review-extra"
            open={extraOpen}
            onToggle={(e) => setExtraOpen(e.currentTarget.open)}
          >
            <summary>
              ข้อมูลเพิ่มเติม
              {["category_id", "area", "workers"].some((k) => fieldErrors[k])
                ? " · มีข้อมูลที่ต้องยืนยัน"
                : ""}
            </summary>
            {row(
              "category_id",
              "ประเภทงาน",
              meta.categories.find((c) => c.id === Number(form.category_id))
                ?.name,
              <div className="category-control">
                <Field label="ประเภทงาน">
                  <select
                    value={form.category_id || ""}
                    onChange={(e) => change("category_id", e.target.value)}
                  >
                    <option value="">ยังไม่ระบุ</option>
                    {meta.categories
                      .filter(
                        (c) => c.active || c.id === Number(form.category_id),
                      )
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </Field>
                <Button
                  type="button"
                  icon={Plus}
                  onClick={() => setAddCategory(true)}
                >
                  เพิ่มประเภทงาน
                </Button>
              </div>,
            )}
            {row("area", "พื้นที่", form.area, textInput("area", "พื้นที่"))}
            {row(
              "workers",
              "ผู้ปฏิบัติงาน",
              form.workers,
              textInput("workers", "ผู้ปฏิบัติงานตามข้อมูลต้นทาง", true),
            )}
          </details>
          {editable && (
            <label className="check">
              <input
                type="checkbox"
                checked={Boolean(form.news_requested)}
                onChange={(e) => change("news_requested", e.target.checked)}
              />
              เสนอเป็นข่าวหลังยืนยันข้อมูล
              ให้ประชาสัมพันธ์ตรวจข้อความและรูปก่อนเผยแพร่
            </label>
          )}
        </section>
        <aside className="panel review-evidence">
          <div className="panel-heading">
            <h2>ต้นฉบับและไฟล์แนบ</h2>
            {editable && (
              <Button
                type="button"
                disabled={busy}
                icon={Plus}
                onClick={() => setAttach(true)}
              >
                เพิ่มไฟล์แนบ
              </Button>
            )}
          </div>
          {record?.source_purged_at && (
            <Notice>
              ลบข้อความต้นฉบับตามอายุเก็บแล้ว
              ยังคงข้อมูลสรุปและประวัติการดำเนินการ
            </Notice>
          )}
          {record?.source_text && <SourceExcerpt text={record.source_text} />}
          {record?.messages?.map((m) => (
            <SourceExcerpt key={m.id} text={m.text || "ไฟล์จาก LINE"} />
          ))}
          <small className="muted">
            {record
              ? `รับข้อมูล ${fmt(record.created_at, true)} · ${record.owner_name}`
              : "รายงานใหม่"}
          </small>
          <div className="review-files">
            {evidence.map((f) => (
              <button type="button" key={f.id} onClick={() => setPreview(f)}>
                {!f.purged && f.mime.startsWith("image/") ? (
                  <img src={fileUrl(f.id)} alt={f.original_name} />
                ) : (
                  <FileText size={24} />
                )}
                <span>
                  {f.original_name || f.title}
                  {f.purged ? " · ครบอายุเก็บแล้ว" : ""}
                </span>
                <small>{bytes(f.size)}</small>
              </button>
            ))}
          </div>
          {!evidence.length && <p className="muted">ยังไม่มีไฟล์แนบ</p>}
          {!!record?.history?.length && (
            <details className="review-history">
              <summary>ประวัติการแก้ไข</summary>
              {record.history.map((h, i) => (
                <p key={i}>
                  {h.action} · {h.actor_name}
                  <br />
                  <small>{fmt(h.created_at, true)}</small>
                </p>
              ))}
            </details>
          )}
        </aside>
      </div>
      {editable && (
        <div className="review-savebar">
          {error && <Notice error>{error}</Notice>}
          {Object.values(fieldErrors).filter(Boolean).length > 0 && (
            <div className="review-errors" role="alert">
              {Object.entries(fieldErrors)
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <button
                    type="button"
                    key={k}
                    onClick={() => {
                      edit(k);
                      requestAnimationFrame(() =>
                        document.getElementById("review-" + k)?.scrollIntoView({
                          behavior: "smooth",
                          block: "center",
                        }),
                      );
                    }}
                  >
                    {v} — แก้ไข
                  </button>
                ))}
            </div>
          )}
          <div className="actions">
            <Button
              type="button"
              disabled={busy || needsAssignment}
              onClick={() => save("pending")}
            >
              บันทึกไว้ก่อน
            </Button>
            <Button
              primary
              type="button"
              icon={Check}
              disabled={busy || needsAssignment}
              onClick={() => save("ready")}
            >
              {busy ? "กำลังบันทึก…" : "ยืนยันข้อมูลเพื่อสรุป"}
            </Button>
          </div>
        </div>
      )}
      {preview && (
        <FilePreview file={preview} onClose={() => setPreview(null)} />
      )}{" "}
      {addCategory && (
        <CategoryCreator
          onClose={() => setAddCategory(false)}
          onCreated={(category) => {
            change("category_id", category.id);
            setAddCategory(false);
          }}
        />
      )}
      {attach && (
        <AttachmentPicker
          fresh={fresh}
          excludedIds={evidence.map((f) => f.id)}
          onClose={() => setAttach(false)}
          onPick={async (f) => {
            if (evidence.some((x) => x.id === f.id)) return;
            if (fresh) {
              setEvidence((prev) => [...prev, f]);
              setForm((prev) => ({
                ...prev,
                file_ids: [...prev.file_ids, f.id],
              }));
              notify("เลือกไฟล์แล้ว จะจัดเก็บพร้อมรายงาน");
            } else {
              const out = await api("/activities/" + id + "/attachments", {
                method: "POST",
                body: { file_id: f.id, version: form.version },
              });
              setEvidence((prev) => [...prev, out.file]);
              setForm((prev) => ({ ...prev, version: out.version }));
              setRecord((prev) => ({ ...prev, version: out.version }));
              notify("เพิ่มไฟล์แนบแล้ว");
            }
            setAttach(false);
          }}
        />
      )}
    </>
  );
}
function ReviewItem({
  field,
  label,
  value,
  editing,
  editable,
  busy,
  error,
  onEdit,
  onDone,
  children,
}) {
  return (
    <div
      id={"review-" + field}
      className={`review-item ${error ? "has-error" : ""}`}
    >
      <div className="review-item-heading">
        <h3>{label}</h3>
        {editable && (
          <Button
            type="button"
            disabled={busy}
            aria-label={(editing ? "ปิดการแก้ไข " : "แก้ไข ") + label}
            onClick={editing ? onDone : onEdit}
          >
            {editing ? "เสร็จ" : "แก้ไข"}
          </Button>
        )}
      </div>
      {editing && editable ? (
        <fieldset disabled={busy}>{children}</fieldset>
      ) : (
        <p className={!value ? "muted" : ""}>{value || "ยังไม่ระบุ"}</p>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
function SourceExcerpt({ text }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="source-excerpt">
      <p className={expanded ? "" : "clamped"}>{text}</p>
      {(text.length > 200 || text.split("\n").length > 4) && (
        <button
          type="button"
          className="text-link"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "ย่อข้อความ" : "อ่านทั้งหมด"}
        </button>
      )}
    </div>
  );
}
function CategoryCreator({ onClose, onCreated }) {
  const { refreshMeta, notify } = useApp();
  const [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal title="เพิ่มประเภทงาน" onClose={onClose}>
      <p className="muted">
        ประเภทงานที่เพิ่มจะใช้ร่วมกันทุกฝ่าย และเลือกให้รายการนี้ทันที
      </p>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const category = await api("/categories", {
              method: "POST",
              body: { name },
            });
            await refreshMeta();
            onCreated(category);
            notify("เพิ่มประเภทงานแล้ว");
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="ชื่อประเภทงาน *">
          <input
            autoFocus
            required
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        {error && <Notice error>{error}</Notice>}
        <div className="modal-actions">
          <Button type="button" onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button primary icon={Plus} disabled={busy}>
            {busy ? "กำลังเพิ่ม…" : "เพิ่มและเลือกประเภทงาน"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function AttachmentPicker({ onClose, onPick, excludedIds, fresh }) {
  const { user, meta } = useApp();
  const [mode, setMode] = useState("upload"),
    [file, setFile] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [page, setPage] = useState(1),
    [search, setSearch] = useState("");
  const uploaded = useRef(null);
  const unit = user.roles.includes("staff")
    ? user.unit_id
    : user.scopes[0] || user.unit_id;
  const work = meta.works.find(
    (w) => w.id === user.work_id && w.unit_id === unit,
  )?.id;
  const r = useResource(
    "/files?" +
      query({
        attachable: "1",
        ...(fresh ? { purpose: "evidence", mine: "1" } : {}),
        page,
        limit: 10,
        q: search,
      }),
  );
  async function attachExisting(f) {
    setBusy(true);
    setError("");
    try {
      await onPick(f);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function uploadFile(e) {
    e.preventDefault();
    if (!file || busy) return;
    if (
      file.size > 20 * 1024 * 1024 ||
      !/\.(pdf|docx|xlsx?|png|jpe?g|webp)$/i.test(file.name)
    ) {
      setError("รองรับ PDF, Word, Excel และรูปภาพ สูงสุด 20 MB ต่อไฟล์");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (!uploaded.current) {
        const body = new FormData();
        body.append("file", file);
        body.append("purpose", "evidence");
        body.append("unit_id", unit);
        if (work) body.append("work_id", work);
        body.append("title", file.name.slice(0, 300));
        uploaded.current = await api("/files", { method: "POST", body });
      }
      await onPick(uploaded.current);
    } catch (e) {
      setError(
        e.message +
          (uploaded.current
            ? " — อัปโหลดแล้ว สามารถลองแนบอีกครั้งหรือเลือกจากคลังไฟล์ได้"
            : ""),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="เพิ่มไฟล์แนบ"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <Tabs
        items={[
          ["upload", "อัปโหลดจากเครื่อง"],
          ["library", "เลือกจากคลังไฟล์"],
        ]}
        value={mode}
        onChange={(v) => {
          if (!busy) {
            setMode(v);
            setError("");
          }
        }}
      />
      {error && <Notice error>{error}</Notice>}
      {mode === "upload" ? (
        <form className="form" onSubmit={uploadFile}>
          <Field label="เลือกไฟล์จากเครื่อง">
            <input
              type="file"
              disabled={busy}
              accept=".pdf,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp"
              onChange={(e) => {
                setFile(e.target.files[0] || null);
                uploaded.current = null;
                setError("");
              }}
            />
          </Field>
          <p className="muted">
            PDF, Word, Excel หรือรูปภาพ · สูงสุด 20 MB ต่อไฟล์
          </p>
          <Button primary type="submit" disabled={busy || !file || !unit}>
            {busy ? "กำลังเพิ่มไฟล์…" : "อัปโหลดและแนบไฟล์"}
          </Button>
        </form>
      ) : (
        <>
          <Field label="ค้นหาไฟล์ในคลัง">
            <input
              value={search}
              disabled={busy}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="ชื่อไฟล์หรือคำสำคัญ"
            />
          </Field>
          <p className="muted">
            เฉพาะไฟล์ที่มีสิทธิ์และยังไม่แนบกับรายงานอื่น
            ไฟล์ฝากเก็บจะคงต้นฉบับไว้ในคลัง
          </p>
          <Resource resource={r}>
            {(d) => (
              <>
                {d.items.filter((f) => !excludedIds.includes(f.id)).length ? (
                  <div className="file-list">
                    {d.items
                      .filter((f) => !excludedIds.includes(f.id))
                      .map((f) => (
                        <button
                          type="button"
                          disabled={busy}
                          key={f.id}
                          onClick={() => attachExisting(f)}
                        >
                          <FileText size={20} />
                          <span>
                            {f.original_name || f.title}
                            {f.purged ? " · ครบอายุเก็บแล้ว" : ""}
                          </span>
                          <small>
                            {f.purpose === "archive"
                              ? "ไฟล์ฝากเก็บ"
                              : "ไฟล์หลักฐาน"}
                          </small>
                          <Plus size={18} />
                        </button>
                      ))}
                  </div>
                ) : (
                  <Empty
                    title="ไม่มีไฟล์ที่เลือกแนบได้"
                    children="อัปโหลดจากเครื่องได้ที่แท็บด้านบน"
                  />
                )}
                <Pager data={d} onPage={setPage} />
              </>
            )}
          </Resource>
        </>
      )}
    </Modal>
  );
}

function IntakeTabs({ active }) {
  const { navigate } = useApp();
  return (
    <div
      className="section-tabs"
      role="navigation"
      aria-label="ช่องทางเพิ่มข้อมูล"
    >
      <button
        className={active === "web" ? "active" : ""}
        onClick={() => navigate("import")}
      >
        ข้อความและไฟล์
      </button>
      <button
        className={active === "line" ? "active" : ""}
        onClick={() => navigate("inbox")}
      >
        รับจาก LINE
      </button>
    </div>
  );
}
function NewsTabs({ active }) {
  const { navigate, isPr } = useApp();
  return (
    isPr && (
      <div className="section-tabs" role="navigation" aria-label="ข่าวภายใน">
        <button
          className={active === "feed" ? "active" : ""}
          onClick={() => navigate("feed")}
        >
          ข่าวที่เผยแพร่
        </button>
        <button
          className={active === "manage" ? "active" : ""}
          onClick={() => navigate("news")}
        >
          จัดการข่าว
        </button>
      </div>
    )
  );
}
function LineInbox() {
  const { meta, navigate, notify } = useApp();
  const [page, setPage] = useState(1),
    [selected, setSelected] = useState([]),
    [busy, setBusy] = useState(false);
  const r = useResource("/inbox?page=" + page);
  return (
    <>
      <Header
        title="รายงานจาก LINE"
        description="เลือกข้อความและรูปภาพของกิจกรรมเดียวกัน เพื่อจัดเป็นหนึ่งรายการงาน"
        action={
          <Button
            primary
            disabled={!selected.length}
            icon={Plus}
            onClick={() => {
              sessionStorage.setItem(
                "rm-new-evidence",
                JSON.stringify({ inbox_ids: selected }),
              );
              navigate("activity/new");
            }}
          >
            สร้างงานจาก {selected.length} รายการ
          </Button>
        }
      />
      <IntakeTabs active="line" />
      {!meta.line.receiveConfigured && (
        <Notice>
          ยังไม่ได้เชื่อมต่อกลุ่มรับรายงาน ให้ผู้ดูแลตั้งค่าก่อนรับข้อมูลจาก
          LINE
        </Notice>
      )}
      {meta.demo?.simulatedInboxCount > 0 && (
        <Notice>
          ข้อความที่ขึ้นต้น [สาธิต]
          เป็นรายการจำลองในเครื่องสำหรับลองขั้นตอนจัดรายงาน
          ยังไม่ใช่ข้อความที่รับจาก LINE จริง
        </Notice>
      )}
      <section className="panel">
        <Resource resource={r}>
          {(d) => (
            <>
              {d.items.length ? (
                <div className="inbox-list">
                  {d.items.map((m) => (
                    <article key={m.id}>
                      <input
                        type="checkbox"
                        aria-label={"เลือกข้อความ " + m.id}
                        disabled={!m.can_edit}
                        checked={selected.includes(m.id)}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, m.id]
                              : selected.filter((x) => x !== m.id),
                          )
                        }
                      />
                      <div>
                        <Badge status="line">LINE · {m.kind}</Badge>
                        <p>{m.text || "ไฟล์ / รูปภาพ"}</p>
                        <small>
                          {m.owner_name || "ยังไม่ผูกบัญชีผู้รายงาน"} ·{" "}
                          {fmt(m.received_at, true)}
                        </small>
                        {m.error && <Notice error>{m.error}</Notice>}
                        {m.kind !== "text" && (
                          <Button
                            disabled={busy || !m.can_edit || !!m.file_id}
                            icon={Download}
                            onClick={async () => {
                              setBusy(true);
                              try {
                                await api("/inbox/" + m.id + "/download", {
                                  method: "POST",
                                  body: {},
                                });
                                r.reload();
                                notify("ดาวน์โหลดหลักฐานแล้ว");
                              } catch (e) {
                                notify(e.message);
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            {m.file_id
                              ? "จัดเก็บหลักฐานแล้ว"
                              : "ดาวน์โหลดหลักฐานจาก LINE"}
                          </Button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <Empty title="ไม่มีรายงาน LINE ที่รอจัดรายการ" />
              )}
              <Pager data={d} onPage={setPage} />
            </>
          )}
        </Resource>
      </section>
    </>
  );
}

function Feed() {
  const [filters, setFilters] = useState({ page: 1 }),
    [selected, setSelected] = useState(null);
  const r = useResource("/news?" + query({ ...filters, feed: "1" }));
  return (
    <>
      <Header
        title="ฟีดข่าวภายใน"
        description="ข่าวสารและผลการปฏิบัติงานที่ผ่านการยืนยันจากเจ้าหน้าที่ประชาสัมพันธ์"
      />
      <NewsTabs active="feed" />
      <Filters
        value={filters}
        onChange={setFilters}
        search={false}
        scope={false}
      />
      <Resource resource={r}>
        {(d) => (
          <>
            {d.items.length ? (
              <div className="news-grid">
                {d.items.map((n) => (
                  <article className="news-card panel" key={n.id}>
                    {n.cover_id ? (
                      <img src={fileUrl(n.cover_id)} alt={n.title} />
                    ) : (
                      <div className="news-placeholder">
                        <Newspaper size={44} />
                        <span>ข่าวสารหน่วยงาน</span>
                      </div>
                    )}
                    <div>
                      <Badge>{n.unit_name}</Badge>
                      <h2>{n.title}</h2>
                      <p>
                        {n.body.slice(0, 145)}
                        {n.body.length > 145 ? "…" : ""}
                      </p>
                      <small>
                        {fmt(n.date)} · {n.area}
                      </small>
                      <button
                        className="text-link"
                        onClick={() => setSelected(n)}
                      >
                        อ่านเพิ่มเติม <ArrowRight size={17} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <section className="panel">
                <Empty
                  title="ยังไม่มีข่าวที่เผยแพร่"
                  children="ข่าวจะปรากฏที่นี่หลังเจ้าหน้าที่ประชาสัมพันธ์ยืนยันเผยแพร่"
                />
              </section>
            )}
            <Pager
              data={d}
              onPage={(page) => setFilters({ ...filters, page })}
            />
          </>
        )}
      </Resource>
      {selected && (
        <NewsPreview news={selected} onClose={() => setSelected(null)} />
      )}
    </>
  );
}
function NewsPreview({ news, onClose, action }) {
  return (
    <Modal
      title={action ? "ตรวจข่าวก่อนเผยแพร่" : "ข่าวภายใน"}
      wide
      onClose={onClose}
    >
      {news.cover_id && (
        <img
          className="news-cover"
          src={fileUrl(news.cover_id)}
          alt={news.title}
        />
      )}
      <h2 className="news-title">{news.title}</h2>
      <p className="muted">
        {news.unit_name} · {fmt(news.date)} · {news.area}
      </p>
      <p className="news-body">{news.body}</p>
      <div className="news-gallery">
        {news.image_ids
          ?.filter((id) => id !== news.cover_id)
          .map((id) => (
            <img key={id} src={fileUrl(id)} alt="ภาพกิจกรรม" />
          ))}
      </div>
      {action && <div className="modal-actions">{action}</div>}
    </Modal>
  );
}
function NewsManager() {
  const { navigate } = useApp();
  const [tab, setTab] = useState("source"),
    [page, setPage] = useState(1);
  const r = useResource(
    tab === "source"
      ? "/news-candidates"
      : "/news?status=" + tab + "&page=" + page,
  );
  return (
    <>
      <Header
        title="จัดการข่าวประชาสัมพันธ์"
        description="เลือกข้อมูลจากรายงานจริง จัดทำข่าว และยืนยันก่อนเผยแพร่"
      />
      <NewsTabs active="manage" />
      <Tabs
        items={[
          ["source", "คิวเรื่องเสนอข่าว"],
          ["draft", "ฉบับร่าง"],
          ["published", "เผยแพร่แล้ว"],
        ]}
        value={tab}
        onChange={(t) => {
          setTab(t);
          setPage(1);
        }}
      />
      <section className="panel">
        <Resource resource={r}>
          {(d) => (
            <>
              {d.items.length ? (
                <div className="news-list">
                  {d.items.map((n) => (
                    <article key={tab === "source" ? n.activity_id : n.id}>
                      <div className="news-list-icon">
                        <Newspaper size={27} />
                      </div>
                      <div>
                        <Badge status={n.status}>
                          {tab === "source"
                            ? n.status === "ready"
                              ? "รายงานพร้อมสรุป"
                              : "รอเจ้าของยืนยันอีกครั้ง"
                            : undefined}
                        </Badge>
                        <h3>{n.title}</h3>
                        <p>
                          {n.unit_name} · {fmt(n.date)}
                        </p>
                        {tab === "published" && (
                          <Badge status={n.line_status} />
                        )}
                      </div>
                      <div className="actions">
                        <Button
                          onClick={() =>
                            navigate(
                              "activity/" +
                                (tab === "source"
                                  ? n.activity_id
                                  : n.activity_id),
                            )
                          }
                          icon={FileText}
                        >
                          ดูต้นทาง
                        </Button>
                        <Button
                          primary
                          disabled={tab === "source" && n.status !== "ready"}
                          onClick={() =>
                            navigate(
                              "news/" +
                                (tab === "source"
                                  ? "new?activity=" + n.activity_id
                                  : n.id),
                            )
                          }
                          icon={tab === "published" ? Eye : Plus}
                        >
                          {tab === "published" ? "ดูรายละเอียด" : "จัดทำข่าว"}
                        </Button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <Empty title="ไม่มีรายการในหมวดนี้" />
              )}
              {tab !== "source" && <Pager data={d} onPage={setPage} />}
            </>
          )}
        </Resource>
      </section>
      <Notice>
        ข่าวฉบับเผยแพร่เป็นข้อมูลแยกจากรายงานต้นทาง และไม่มีการเผยแพร่อัตโนมัติ
        เจ้าของรายงานส่งเข้าคิวเดียวกับรายงานเดิม
        ประชาสัมพันธ์ตรวจข้อความและภาพก่อนเผยแพร่
      </Notice>
    </>
  );
}
function NewsEditor({ id }) {
  const { navigate, notify, meta } = useApp();
  const isNew = id.startsWith("new"),
    [form, setForm] = useState(null),
    [source, setSource] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState(false),
    [imagesReviewed, setImagesReviewed] = useState(false);
  useEffect(() => {
    let alive = true;
    setForm(null);
    (async () => {
      try {
        const news = isNew ? null : await api("/news/" + id);
        const activityId =
          news?.activity_id ||
          Number(new URLSearchParams(id.split("?")[1]).get("activity"));
        const activity = await api("/activities/" + activityId);
        const newsPreview = isNew
          ? await api("/activities/" + activityId + "/news-preview")
          : null;
        if (alive) {
          setSource(activity);
          setForm(
            news || {
              activity_id: activityId,
              title: newsPreview?.title || activity.title,
              body: newsPreview?.body || "",
              image_ids: [],
              cover_id: null,
              status: "draft",
            },
          );
        }
      } catch (e) {
        if (alive) setError(e.message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);
  async function save() {
    const result = await api("/news" + (form.id ? "/" + form.id : ""), {
      method: form.id ? "PUT" : "POST",
      body: form,
    });
    setForm(result);
    return result;
  }
  async function draft() {
    setBusy(true);
    setError("");
    try {
      await save();
      notify("บันทึกฉบับร่างแล้ว");
    } catch (e) {
      setError(e.message + (e.details ? " · " + e.details.join(", ") : ""));
    } finally {
      setBusy(false);
    }
  }
  async function publish() {
    setBusy(true);
    try {
      const saved = await save();
      const out = await api("/news/" + saved.id + "/publish", {
        method: "POST",
        body: {
          version: saved.version,
          images_reviewed: imagesReviewed,
          privacy_reviewed: imagesReviewed,
        },
      });
      setForm(out);
      setPreview(false);
      notify("เผยแพร่บนฟีดภายในแล้ว");
    } catch (e) {
      setError(e.message);
      setPreview(false);
    } finally {
      setBusy(false);
    }
  }
  if (!form) return error ? <Notice error>{error}</Notice> : <Loading />;
  const locked = form.status === "published";
  return (
    <>
      <Header
        title={locked ? "ข่าวที่เผยแพร่แล้ว" : "ตรวจแก้และเผยแพร่ข่าว"}
        description="ข้อความข่าวไม่เปลี่ยนข้อมูลในรายงานต้นฉบับ"
        action={
          <Button
            icon={FileText}
            onClick={() => navigate("activity/" + source.id)}
          >
            ดูรายงานต้นทาง
          </Button>
        }
      />
      {error && <Notice error>{error}</Notice>}
      {locked && (
        <div className="publication-status">
          <Badge status="published" />
          <Badge status={form.line_status} />
          <Button
            disabled={
              busy || form.line_status === "sent" || !meta.line.sendConfigured
            }
            onClick={async () => {
              setBusy(true);
              try {
                setForm(
                  await api("/news/" + form.id + "/send-line", {
                    method: "POST",
                    body: {},
                  }),
                );
                notify("LINE รับคำขอส่งข่าวแล้ว");
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {meta.line.sendConfigured
              ? "ส่งข่าวเข้ากลุ่ม LINE"
              : "ยังไม่ได้เชื่อมต่อ LINE"}
          </Button>
        </div>
      )}
      <div className="detail-grid">
        <section className="panel form-panel">
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              setPreview(true);
            }}
          >
            <fieldset disabled={locked || busy}>
              <Field label="หัวข้อข่าว *">
                <input
                  required
                  maxLength={300}
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
              </Field>
              {!locked && (
                <AISuggestion
                  path={"/activities/" + source.id + "/news-ai-draft"}
                  configured={Boolean(meta.ai?.configured)}
                  onUse={(p) => setForm({ ...form, body: p.summary })}
                />
              )}
              <Field label="เนื้อหาข่าว *">
                <textarea
                  required
                  rows={12}
                  maxLength={20000}
                  value={form.body}
                  placeholder="เรียบเรียงข่าวจากรายงานต้นทาง แล้วตรวจข้อความก่อนเผยแพร่"
                  onChange={(e) => setForm({ ...form, body: e.target.value })}
                />
              </Field>
            </fieldset>
            <div className="source-summary">
              <span>{source.unit_name}</span>
              <span>
                {fmt(source.date)} · {source.area}
              </span>
            </div>
            <div className="actions">
              {!locked && (
                <Button
                  type="button"
                  disabled={busy}
                  icon={Save}
                  onClick={draft}
                >
                  บันทึกฉบับร่าง
                </Button>
              )}
              <Button primary icon={Eye} disabled={busy}>
                {locked ? "อ่านข่าว" : "Preview ก่อนเผยแพร่"}
              </Button>
            </div>
          </form>
        </section>
        <section className="panel form-panel">
          <h2>รูปภาพจากหลักฐาน</h2>
          <p className="muted">เลือกรูปประกอบและกำหนดรูปปก</p>
          {source.files.filter((f) => f.mime.startsWith("image/")).length ? (
            <div className="image-picker">
              {source.files
                .filter((f) => f.mime.startsWith("image/"))
                .map((f) => (
                  <label
                    key={f.id}
                    className={form.image_ids.includes(f.id) ? "selected" : ""}
                  >
                    <img src={fileUrl(f.id)} alt={f.title} />
                    <span>
                      <input
                        type="checkbox"
                        disabled={locked || busy}
                        checked={form.image_ids.includes(f.id)}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            image_ids: e.target.checked
                              ? [...form.image_ids, f.id]
                              : form.image_ids.filter((x) => x !== f.id),
                            cover_id:
                              !e.target.checked && form.cover_id === f.id
                                ? null
                                : form.cover_id,
                          })
                        }
                      />
                      {f.title}
                    </span>
                  </label>
                ))}
            </div>
          ) : (
            <Empty title="รายงานนี้ไม่มีรูปภาพแนบ" />
          )}
          <Field label="รูปปก">
            <select
              disabled={locked || busy}
              value={form.cover_id || ""}
              onChange={(e) =>
                setForm({
                  ...form,
                  cover_id: e.target.value ? Number(e.target.value) : null,
                })
              }
            >
              <option value="">ไม่ใช้รูปปก</option>
              {source.files
                .filter((f) => form.image_ids.includes(f.id))
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.title}
                  </option>
                ))}
            </select>
          </Field>
          {!locked && (
            <label className="check">
              <input
                type="checkbox"
                checked={imagesReviewed}
                onChange={(e) => setImagesReviewed(e.target.checked)}
              />
              ตรวจข้อมูลส่วนบุคคลในข้อความ สิทธิ์และความเหมาะสมของรูปภาพแล้ว
            </label>
          )}
          <Notice>
            การเผยแพร่จะแสดงบนฟีดภายในก่อน การส่ง LINE
            เป็นอีกขั้นตอนหนึ่งและแสดงสถานะแยกกัน
          </Notice>
        </section>
      </div>
      {preview && (
        <NewsPreview
          news={{
            ...form,
            unit_name: locked
              ? form.publication_unit_name || source.unit_name
              : source.unit_name,
            date: locked ? form.activity_date || source.date : source.date,
            area: locked ? form.activity_area || source.area : source.area,
          }}
          onClose={() => setPreview(false)}
          action={
            !locked && (
              <Button primary disabled={busy} icon={Check} onClick={publish}>
                {busy ? "กำลังเผยแพร่…" : "ยืนยันเผยแพร่"}
              </Button>
            )
          }
        />
      )}
    </>
  );
}

function Admin({ tab: requestedTab }) {
  const [settingsView, setSettingsView] = useState("organization");
  const { navigate, meta, user } = useApp();
  const tab = ["users", "master", "line"].includes(requestedTab)
    ? requestedTab
    : "users";
  return (
    <>
      <Header
        title="ดูแลระบบ"
        description="จัดการผู้ใช้ หน่วยงาน รูปแบบรายงาน และการเชื่อมต่อ"
        action={
          <Button icon={History} onClick={() => navigate("audit")}>
            ประวัติการแก้ไขข้อมูล
          </Button>
        }
      />
      <Tabs
        items={[
          ["users", "ผู้ใช้งานและสิทธิ์"],
          ["master", "หน่วยงานและหมวดข้อมูล"],
          ["line", "การเชื่อมต่อ LINE"],
        ]}
        value={tab}
        onChange={(value) => navigate("admin/" + value)}
      />
      {tab === "users" ? (
        <>
          <UsersAdmin />
          <RoleApprovals user={user} />
        </>
      ) : tab === "master" ? (
        <>
          <div className="section-tabs" aria-label="ตั้งค่าข้อมูล">
            <button
              className={settingsView === "organization" ? "active" : ""}
              onClick={() => setSettingsView("organization")}
            >
              ฝ่าย งาน และประเภทงาน
            </button>
            <button
              className={settingsView === "templates" ? "active" : ""}
              onClick={() => setSettingsView("templates")}
            >
              รูปแบบรายงาน
            </button>
            <button
              className={settingsView === "scope" ? "active" : ""}
              onClick={() => setSettingsView("scope")}
            >
              ค่ามาตรฐานและงานอัตโนมัติ
            </button>
          </div>
          {settingsView === "scope" ? (
            <ScopeAdmin meta={meta} />
          ) : settingsView === "organization" ? (
            <MasterAdmin />
          ) : (
            <TemplatesAdmin meta={meta} />
          )}
          <OrganizationHistory />
          <ReadingStatus />
        </>
      ) : (
        <>
          <LineAdmin />
          <LineProcessingStatus />
        </>
      )}
    </>
  );
}
function UsersAdmin() {
  const { meta, user } = useApp();
  const resource = useResource("/admin/users");
  const [editing, setEditing] = useState(null);
  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>บัญชีผู้ใช้งาน</h2>
            <p>กำหนดบทบาท สถานะบัญชี และฝ่ายกับงานประจำของพนักงาน</p>
          </div>
          <Button
            primary
            icon={Plus}
            onClick={() =>
              setEditing({
                username: "",
                name: "",
                unit_id: "",
                work_id: "",
                roles: ["staff"],
                scopes: [],
                active: true,
                line_user_id: "",
              })
            }
          >
            เพิ่มบัญชี
          </Button>
        </div>
        <Resource resource={resource}>
          {(rows) => (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>ผู้ใช้งาน</th>
                    <th>ฝ่าย / งานที่รับผิดชอบ</th>
                    <th>บทบาท</th>
                    <th>สถานะ</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <strong>{u.name}</strong>
                        <small>
                          {u.username}
                          {u.id === user.id ? " · คุณ" : ""}
                        </small>
                      </td>
                      <td>
                        {u.unit_name || "ส่วนกลาง"}
                        {u.roles.includes("staff") && (
                          <small
                            className={!u.work_id ? "assignment-pending" : ""}
                          >
                            {u.work_name || "รอกำหนดงานโดยผู้ดูแลระบบ"}
                          </small>
                        )}
                        {u.roles.includes("head") && (
                          <small>
                            ขอบเขตหัวหน้า:{" "}
                            {u.scopes
                              .map(
                                (id) =>
                                  meta.units.find((unit) => unit.id === id)
                                    ?.name || `หน่วยงาน #${id}`,
                              )
                              .join(" / ") || "ยังไม่กำหนด"}
                          </small>
                        )}
                      </td>
                      <td>
                        <div className="role-list">
                          {u.roles.map((r) => (
                            <Badge key={r}>{meta.roles[r]}</Badge>
                          ))}
                        </div>
                      </td>
                      <td>
                        <Badge status={u.active ? "ready" : "pending"}>
                          {u.active ? "ใช้งาน" : "ระงับบัญชี"}
                        </Badge>
                      </td>
                      <td>
                        <Button
                          onClick={() =>
                            setEditing({
                              ...u,
                              password: "",
                              line_user_id: u.line_user_id || "",
                            })
                          }
                        >
                          แก้ไข
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Resource>
      </section>
      <Notice>
        พนักงานแต่ละคนมี 1 ฝ่ายและ 1 งานตามที่แอดมินกำหนด
        การแก้รายงานใช้สิทธิ์พนักงานเจ้าของรายการหรือหัวหน้าตามขอบเขตที่รับผิดชอบ
        ส่วนการจัดทำและเผยแพร่ข่าวใช้สิทธิ์ประชาสัมพันธ์
      </Notice>
      {editing && (
        <UserForm
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            resource.reload();
          }}
        />
      )}
    </>
  );
}
function UserForm({ initial, onClose, onSaved }) {
  const { meta, notify } = useApp();
  const [form, setForm] = useState({
      ...initial,
      work_scopes: initial.work_scopes || [],
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [separateAffiliation, setSeparateAffiliation] = useState(
    Boolean(
      initial.roles.includes("staff") &&
      initial.roles.includes("head") &&
      initial.unit_id &&
      !initial.scopes.includes(initial.unit_id),
    ),
  );
  const set = (k, v) =>
    setForm((f) => {
      if (k === "scopes" && f.roles.includes("head") && !separateAffiliation)
        return {
          ...f,
          scopes: v,
          unit_id: v[0] || null,
          work_id: f.unit_id === v[0] ? f.work_id : null,
        };
      if (
        k === "roles" &&
        v.includes("head") &&
        v.includes("staff") &&
        !f.unit_id
      )
        return { ...f, roles: v, unit_id: f.scopes[0] || null };
      return { ...f, [k]: v };
    });
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        ...form,
        // Hidden staff fields must not assign a department to a new head account.
        // Retain pre-existing affiliation metadata for other roles on edit.
        unit_id: form.roles.some((r) => ["staff", "center_head"].includes(r))
          ? form.unit_id
            ? Number(form.unit_id)
            : null
          : initial.unit_id || null,
        work_id:
          form.roles.includes("staff") && form.work_id
            ? Number(form.work_id)
            : null,
        line_user_id: form.line_user_id || null,
        password: form.password || undefined,
      };
      await api("/admin/users" + (form.id ? "/" + form.id : ""), {
        method: form.id ? "PUT" : "POST",
        body: payload,
      });
      notify("บันทึกบัญชีและสิทธิ์แล้ว");
      onSaved();
    } catch (e) {
      setError(e.message + (e.details ? " · " + e.details.join(" / ") : ""));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={form.id ? "แก้ไขบัญชีผู้ใช้งาน" : "เพิ่มบัญชีผู้ใช้งาน"}
      onClose={onClose}
    >
      <form className="form" onSubmit={save}>
        <div className="form-row">
          <Field label="ชื่อผู้ใช้ *">
            <input
              required
              pattern="[a-zA-Z0-9._\-]{3,60}"
              value={form.username}
              onChange={(e) => set("username", e.target.value)}
              autoComplete="off"
            />
          </Field>
          <Field label="ชื่อ–นามสกุล *">
            <input
              required
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </Field>
        </div>
        <Field
          label={
            form.id
              ? "ตั้งรหัสผ่านใหม่ (เว้นว่างเพื่อคงเดิม)"
              : "รหัสผ่านอย่างน้อย 12 ตัวอักษร *"
          }
        >
          <input
            type="password"
            minLength={12}
            maxLength={128}
            required={!form.id}
            autoComplete="new-password"
            value={form.password || ""}
            onChange={(e) => set("password", e.target.value)}
          />
        </Field>
        <div>
          <span className="field-label">บทบาท *</span>
          <div className="checkbox-grid">
            {Object.entries(meta.roles).map(([key, name]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={form.roles.includes(key)}
                  onChange={(e) =>
                    set(
                      "roles",
                      e.target.checked
                        ? [...form.roles, key]
                        : form.roles.filter((r) => r !== key),
                    )
                  }
                />
                {name}
              </label>
            ))}
          </div>
        </div>
        {form.roles.includes("head") && (
          <div>
            <span className="field-label">หน่วยงานที่หัวหน้ารับผิดชอบ *</span>
            <div className="checkbox-grid">
              {meta.units
                .filter((u) => u.active && u.kind !== "section")
                .map((u) => (
                  <label key={u.id}>
                    <input
                      type="checkbox"
                      checked={form.scopes.includes(u.id)}
                      onChange={(e) =>
                        set(
                          "scopes",
                          e.target.checked
                            ? [...form.scopes, u.id]
                            : form.scopes.filter((id) => id !== u.id),
                        )
                      }
                    />
                    {u.name}
                  </label>
                ))}
            </div>
          </div>
        )}
        {form.roles.some((r) => ["staff", "center_head"].includes(r)) && (
          <section className="account-assignment" aria-label="กำหนดฝ่ายและงาน">
            <h3>ฝ่ายและงานสำหรับบทบาทพนักงาน</h3>
            {form.roles.includes("head") && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={separateAffiliation}
                  onChange={(e) => {
                    setSeparateAffiliation(e.target.checked);
                    if (!e.target.checked)
                      setForm((f) => ({
                        ...f,
                        unit_id: f.scopes[0] || null,
                        work_id: f.unit_id === f.scopes[0] ? f.work_id : null,
                      }));
                  }}
                />
                ฝ่ายปฏิบัติงานต่างจากฝ่ายที่ดูแล
              </label>
            )}
            {form.roles.includes("head") && !separateAffiliation ? (
              <Field label="ฝ่ายที่รับผิดชอบ">
                <input
                  readOnly
                  value={
                    meta.units.find((u) => u.id === Number(form.unit_id))
                      ?.name || "เลือกฝ่ายที่รับผิดชอบด้านบน"
                  }
                />
              </Field>
            ) : (
              <>
                {" "}
                <Field label="ฝ่าย/กลุ่มงาน">
                  <select
                    value={form.unit_id || ""}
                    required
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        unit_id: e.target.value,
                        work_id: "",
                      }))
                    }
                  >
                    <option value="">เลือกฝ่าย/กลุ่มงาน</option>
                    <UnitOptions
                      units={meta.units}
                      allowed={meta.units.filter(
                        (u) => u.active || u.id === form.unit_id,
                      )}
                    />
                  </select>
                </Field>
              </>
            )}
            <Field label="งานที่รับผิดชอบ *">
              <select
                required
                disabled={!form.unit_id}
                value={form.work_id || ""}
                onChange={(e) => set("work_id", e.target.value)}
              >
                <option value="">
                  {!form.unit_id
                    ? "เลือกฝ่ายก่อน แล้วเลือกงาน"
                    : "เลือกงานในฝ่ายที่สังกัด"}
                </option>
                <WorkOptions
                  works={meta.works.filter((w) => w.active)}
                  unitId={form.unit_id}
                  selected={form.work_id}
                />
              </select>
            </Field>
          </section>
        )}
        {form.roles.includes("center_head") && (
          <fieldset>
            <legend>ศูนย์/งานที่หัวหน้าศูนย์รับผิดชอบ</legend>
            {meta.works
              .filter((w) => w.active && w.unit_id === Number(form.unit_id))
              .map((w) => (
                <label className="check" key={w.id}>
                  <input
                    type="checkbox"
                    checked={form.work_scopes.includes(w.id)}
                    onChange={(e) =>
                      set(
                        "work_scopes",
                        e.target.checked
                          ? [...form.work_scopes, w.id]
                          : form.work_scopes.filter((id) => id !== w.id),
                      )
                    }
                  />
                  {w.name}
                </label>
              ))}
          </fieldset>
        )}
        <div className="form-row">
          <Field label="ตำแหน่ง">
            <input
              value={form.position || ""}
              onChange={(e) => set("position", e.target.value)}
            />
          </Field>
          <Field label="ประเภทบุคลากร (สำหรับแบบสรุป)">
            <input
              value={form.personnel_type || ""}
              onChange={(e) => set("personnel_type", e.target.value)}
            />
          </Field>
        </div>
        <Field label="LINE User ID (ถ้ามี)">
          <input
            value={form.line_user_id || ""}
            placeholder="U…"
            onChange={(e) => set("line_user_id", e.target.value)}
          />
        </Field>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => set("active", e.target.checked)}
          />
          เปิดใช้งานบัญชี
        </label>
        {error && <Notice error>{error}</Notice>}
        <div className="modal-actions">
          <Button type="button" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button primary disabled={busy} icon={Save}>
            {busy ? "กำลังบันทึก…" : "บันทึกบัญชี"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function MasterAdmin() {
  const { meta, refreshMeta, notify } = useApp();
  const [editing, setEditing] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const edit = (table, item = {}) => {
    setError("");
    setEditing({
      name: "",
      active: true,
      kind: "division",
      parent_id: null,
      unit_id: "",
      ...item,
      active: item.active !== undefined ? !!item.active : true,
      table,
    });
  };
  const change = (key, value) => setEditing((e) => ({ ...e, [key]: value }));
  const divisions = meta.units.filter((u) => u.kind !== "section");
  const renderUnit = (unit) => {
    const works = meta.works.filter((w) => w.unit_id === unit.id);
    return (
      <details className="organization-unit" key={unit.id}>
        <summary>
          <span>
            {unit.name}
            {!unit.active && " (ปิดใช้)"}
          </span>
          <small>{works.length} งาน</small>
        </summary>
        <div className="organization-actions">
          <Button onClick={() => edit("units", unit)}>
            แก้ไขฝ่าย/กลุ่มงาน
          </Button>
          <Button
            icon={Plus}
            onClick={() => edit("works", { unit_id: unit.id })}
          >
            เพิ่มงาน
          </Button>
        </div>
        <div className="master-list">
          {works.map((work) => (
            <div key={work.id} className={work.parent_id ? "sub-work" : ""}>
              <span>
                {work.name}
                {work.parent_id && (
                  <small>
                    ภายใต้ {works.find((w) => w.id === work.parent_id)?.name}
                  </small>
                )}
              </span>
              {!work.active && <Badge status="pending">ปิดใช้</Badge>}
              <Button onClick={() => edit("works", work)}>แก้ไข</Button>
            </div>
          ))}
          {!works.length && (
            <p className="muted organization-actions">ยังไม่มีงานในฝ่ายนี้</p>
          )}
        </div>
      </details>
    );
  };
  return (
    <>
      <div className="master-grid organization-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>ส่วน → ฝ่าย/กลุ่มงาน → งาน</h2>
              <p>เลือกฝ่ายเพื่อดูงานในสังกัด</p>
            </div>
            <Button icon={Plus} onClick={() => edit("units")}>
              เพิ่มหน่วยงาน
            </Button>
          </div>
          {divisions
            .filter(
              (u) =>
                !u.parent_id ||
                !meta.units.some(
                  (p) => p.id === u.parent_id && p.kind === "section",
                ),
            )
            .map(renderUnit)}
          {meta.units
            .filter((u) => u.kind === "section")
            .map((section) => (
              <section className="organization-section" key={section.id}>
                <div className="organization-heading">
                  <h3>
                    {section.name}
                    {!section.active && " (ปิดใช้)"}
                  </h3>
                  <Button onClick={() => edit("units", section)}>
                    แก้ไขส่วน
                  </Button>
                </div>
                {divisions
                  .filter((u) => u.parent_id === section.id)
                  .map(renderUnit)}
              </section>
            ))}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>ประเภทงาน</h2>
              <p>ใช้ร่วมกันทุกฝ่าย</p>
            </div>
            <Button icon={Plus} onClick={() => edit("categories")}>
              เพิ่มประเภทงาน
            </Button>
          </div>
          <div className="master-list">
            {meta.categories.map((item) => (
              <div key={item.id}>
                <span>{item.name}</span>
                {!item.active && <Badge status="pending">ปิดใช้</Badge>}
                <Button onClick={() => edit("categories", item)}>แก้ไข</Button>
              </div>
            ))}
          </div>
        </section>
      </div>
      {editing && (
        <Modal
          title={
            {
              units: "จัดการส่วนและฝ่าย/กลุ่มงาน",
              works: "จัดการงานตามฝ่าย",
              categories: "จัดการประเภทงาน",
            }[editing.table]
          }
          onClose={() => setEditing(null)}
        >
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                await api(
                  "/admin/" +
                    editing.table +
                    (editing.id ? "/" + editing.id : ""),
                  { method: editing.id ? "PUT" : "POST", body: editing },
                );
                await refreshMeta();
                setEditing(null);
                notify("บันทึกข้อมูลตั้งต้นแล้ว");
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="ชื่อ *">
              <input
                required
                maxLength={200}
                value={editing.name}
                onChange={(e) => change("name", e.target.value)}
              />
            </Field>
            {editing.table === "units" && (
              <>
                <Field label="ระดับหน่วยงาน">
                  <select
                    value={editing.kind}
                    onChange={(e) =>
                      setEditing((v) => ({
                        ...v,
                        kind: e.target.value,
                        parent_id: null,
                      }))
                    }
                  >
                    <option value="section">ส่วน</option>
                    <option value="division">ฝ่าย</option>
                    <option value="group">กลุ่มงาน</option>
                  </select>
                </Field>
                {editing.kind !== "section" && (
                  <Field label="ส่วนที่สังกัด">
                    <select
                      value={editing.parent_id || ""}
                      onChange={(e) =>
                        change("parent_id", Number(e.target.value) || null)
                      }
                    >
                      <option value="">สังกัดสำนักโดยตรง</option>
                      {meta.units
                        .filter((u) => u.kind === "section")
                        .map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                )}
              </>
            )}
            {editing.table === "works" && (
              <>
                <Field label="ฝ่าย/กลุ่มงาน *">
                  <select
                    required
                    value={editing.unit_id}
                    onChange={(e) =>
                      setEditing((v) => ({
                        ...v,
                        unit_id: Number(e.target.value),
                        parent_id: null,
                      }))
                    }
                  >
                    <option value="">เลือกฝ่าย/กลุ่มงาน</option>
                    <UnitOptions
                      units={meta.units}
                      allowed={divisions.filter(
                        (u) => u.active || u.id === editing.unit_id,
                      )}
                    />
                  </select>
                </Field>
                <Field label="งานแม่ (ถ้ามี)">
                  <select
                    value={editing.parent_id || ""}
                    onChange={(e) =>
                      change("parent_id", Number(e.target.value) || null)
                    }
                  >
                    <option value="">ไม่มีงานแม่</option>
                    {meta.works
                      .filter(
                        (w) =>
                          w.unit_id === editing.unit_id && w.id !== editing.id,
                      )
                      .map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                  </select>
                </Field>
              </>
            )}
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={editing.active}
                onChange={(e) => change("active", e.target.checked)}
              />
              เปิดใช้งาน
            </label>
            {error && <Notice error>{error}</Notice>}
            <div className="modal-actions">
              <Button type="button" onClick={() => setEditing(null)}>
                ยกเลิก
              </Button>
              <Button primary disabled={busy} icon={Save}>
                บันทึก
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
function LineAdmin() {
  const { navigate } = useApp();
  const r = useResource("/admin/line");
  return (
    <Resource resource={r}>
      {(d) => (
        <>
          <div className="panel-heading">
            <div>
              <h2>ช่องทางรับรายงานและส่งข่าว</h2>
              <p>ตรวจค่าที่ตั้งไว้และประวัติรับ–ส่งจริงล่าสุด</p>
            </div>
            <Button icon={RefreshCw} onClick={r.reload}>
              โหลดสถานะล่าสุด
            </Button>
          </div>
          <div className="master-grid">
            {[
              [
                d.receiveConfigured,
                "กลุ่มรับรายงาน",
                d.reportGroupId,
                d.lastReceived,
                "รับรายงานล่าสุด",
              ],
              [
                d.sendConfigured,
                "กลุ่มส่งข่าว",
                d.newsGroupId,
                d.lastSent,
                "ส่งข่าวสำเร็จล่าสุด",
              ],
            ].map(([ready, title, groupId, last, lastLabel]) => (
              <section className="panel form-panel" key={title}>
                <div className="connection-icon">
                  <Link size={27} />
                </div>
                <h2>{title}</h2>
                <Badge status={ready ? "ready" : "pending"}>
                  {ready ? "ตั้งค่าช่องทางแล้ว" : "ยังไม่ได้ตั้งค่า"}
                </Badge>
                <dl className="line-details">
                  <dt>Group ID</dt>
                  <dd>
                    {groupId ? <code>{groupId}</code> : "ยังไม่ได้กำหนดกลุ่ม"}
                  </dd>
                  <dt>{lastLabel}</dt>
                  <dd>
                    {last ? fmt(last, true) : "ยังไม่มีประวัติรับ–ส่งจริง"}
                  </dd>
                </dl>
              </section>
            ))}
          </div>
          <Notice>
            หน้านี้แสดงสถานะแบบอ่านอย่างเดียว
            หากต้องการเปลี่ยนกลุ่มหรือข้อมูลเชื่อมต่อ ให้ตั้งค่า Channel secret,
            Access token และ Group ID ในไฟล์ .env บนเซิร์ฟเวอร์
            แล้วเริ่มระบบใหม่ โดย webhook ต้องเป็น HTTPS ที่ LINE เข้าถึงได้:{" "}
            <code>{d.webhookPath}</code>
            <br />
            สถานะ “ตั้งค่าช่องทางแล้ว” หมายถึงมีค่าตั้งค่า ยังไม่ใช่การยืนยันว่า
            LINE ติดต่อสำเร็จ
          </Notice>
          <section className="panel form-panel">
            <h2>ผู้รายงานที่ยังไม่ได้ผูกบัญชี</h2>
            <p>
              {d.unmappedUsers.length
                ? "คัดลอก LINE User ID ไปกำหนดในบัญชีผู้ใช้งานที่ตรงกับผู้รายงาน"
                : "ไม่มีผู้รายงานที่รอผูกบัญชี"}
            </p>
            {d.unmappedUsers.map((u) => (
              <p className="line-user-id" key={u.line_user_id}>
                <code>{u.line_user_id}</code>
              </p>
            ))}
            <Button icon={Users} onClick={() => navigate("admin/users")}>
              ไปจัดการผู้ใช้งานและสิทธิ์
            </Button>
          </section>
        </>
      )}
    </Resource>
  );
}
const auditEntities = {
  summary_template: "แม่แบบสรุปผล",
  summary_draft: "ฉบับรายงานสรุป",
  project: "โครงการและงานมอบหมาย",
  report_export: "ส่งออกสรุปผลงาน",
  activity: "รายการงาน",
  news: "ข่าว",
  user: "บัญชีผู้ใช้งาน",
  file: "ไฟล์",
  inbox: "รายงานจาก LINE",
  units: "หน่วยงาน",
  works: "งานตามฝ่าย",
  categories: "ประเภทงาน",
};
function AuditChanges({ entry }) {
  const before = entry.before_json ? JSON.parse(entry.before_json) : {};
  const after = entry.after_json ? JSON.parse(entry.after_json) : {};
  const fields = [
    ...new Set([...Object.keys(before), ...Object.keys(after)]),
  ].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
  const labels = {
    id: "รหัสรายการ",
    username: "ชื่อผู้ใช้",
    name: "ชื่อ",
    title: "ชื่อเรื่อง",
    roles: "บทบาท",
    scopes: "ขอบเขตหน่วยงานของหัวหน้า",
    active: "เปิดใช้งาน",
    unit_id: "รหัสฝ่าย/กลุ่มงาน",
    unit_name: "ฝ่าย/กลุ่มงาน",
    work_id: "รหัสงาน",
    work_name: "งานที่รับผิดชอบ",
    project_id: "รหัสโครงการ",
    task_id: "รหัสงานมอบหมาย",
    assignee_id: "รหัสผู้รับมอบหมาย",
    due_date: "กำหนดส่ง",
    note: "หมายเหตุ",
    description: "รายละเอียด",
    parent_id: "รหัสสังกัด/งานแม่",
    kind: "ประเภท",
    category_id: "รหัสประเภทงาน",
    line_user_id: "LINE User ID",
    status: "สถานะ",
    date: "วันที่ปฏิบัติงาน",
    area: "พื้นที่",
    workers: "ผู้ปฏิบัติงาน",
    result: "ผลการดำเนินงาน",
    metrics: "ตัวเลขผลการดำเนินงาน",
    body: "เนื้อหาข่าว",
    owner_id: "รหัสเจ้าของรายการ",
    created_at: "วันที่สร้าง",
    updated_at: "วันที่แก้ไข",
    version: "รุ่นข้อมูล",
    activity_id: "รหัสรายงานต้นทาง",
    original_name: "ชื่อไฟล์",
    purpose: "วัตถุประสงค์",
    published_at: "วันที่เผยแพร่",
    published_by: "รหัสผู้เผยแพร่",
    source: "แหล่งข้อมูล",
  };
  const value = (key, v) => {
    if (v === undefined || v === null || v === "") return "—";
    if (key === "roles" && Array.isArray(v))
      return v.map((role) => roleNames[role] || role).join(", ");
    if (key === "active") return v ? "เปิดใช้งาน" : "ปิดใช้งาน";
    if (key === "status")
      return (
        {
          pending: "ตรวจข้อมูลที่อ่านได้",
          duplicate: "ซ้ำ ไม่รวมยอด",
          ready: "พร้อมสรุป",
          draft: "ฉบับร่าง",
          published: "เผยแพร่แล้ว",
        }[v] || v
      );
    return typeof v === "object" ? JSON.stringify(v, null, 2) : String(v);
  };
  if (entry.redacted)
    return (
      <Notice>
        เปลี่ยนแปลง{" "}
        {(entry.changed_fields || []).map((k) => labels[k] || k).join(" / ") ||
          "ข้อมูลรายการ"}{" "}
        · แสดงผู้ทำรายการและเวลาได้ แต่ค่ารายละเอียดจำกัดตามสิทธิ์อ่านต้นทาง
      </Notice>
    );
  return fields.length ? (
    <div className="table-scroll audit-changes">
      <table>
        <thead>
          <tr>
            <th scope="col">ข้อมูลที่เปลี่ยน</th>
            <th scope="col">ค่าเดิม</th>
            <th scope="col">ค่าใหม่</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((key) => (
            <tr key={key}>
              <th scope="row">{labels[key] || key}</th>
              <td data-label="ค่าเดิม">{value(key, before[key])}</td>
              <td data-label="ค่าใหม่">{value(key, after[key])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Notice>รายการนี้ไม่มีค่าที่เปลี่ยนแปลงในข้อมูลที่บันทึกไว้</Notice>
  );
}
function Audit() {
  const [filters, setFilters] = useState({ page: 1 }),
    [selected, setSelected] = useState(null);
  const { navigate, isPr } = useApp();
  const r = useResource("/admin/audits?" + query(filters));
  return (
    <>
      <Header
        title="ประวัติการแก้ไขข้อมูล"
        description="ตรวจสอบผู้แก้ไข ค่าเดิม และค่าใหม่ · ข้อมูลอ่านอย่างเดียว"
      />
      <div className="filters">
        <label className="search-field">
          <Search size={19} />
          <input
            aria-label="ค้นหาประวัติ"
            placeholder="ค้นหาผู้แก้ไข หรือประเภทการเปลี่ยนแปลง"
            value={filters.q || ""}
            onChange={(e) =>
              setFilters({ ...filters, q: e.target.value, page: 1 })
            }
          />
        </label>
        <label className="audit-entity-filter">
          ประเภทรายการ
          <select
            aria-label="ประเภทรายการ"
            value={filters.entity || ""}
            onChange={(e) =>
              setFilters({ ...filters, entity: e.target.value, page: 1 })
            }
          >
            <option value="">ทุกประเภท</option>
            {Object.entries(auditEntities).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="date-filter">
          ตั้งแต่
          <input
            type="date"
            value={filters.from || ""}
            onChange={(e) =>
              setFilters({ ...filters, from: e.target.value, page: 1 })
            }
          />
        </label>
        <label className="date-filter">
          ถึง
          <input
            type="date"
            value={filters.to || ""}
            onChange={(e) =>
              setFilters({ ...filters, to: e.target.value, page: 1 })
            }
          />
        </label>
      </div>
      <section className="panel">
        <Resource resource={r}>
          {(d) => (
            <>
              {d.items.length ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>วันเวลา</th>
                        <th>ผู้แก้ไข</th>
                        <th>การเปลี่ยนแปลง</th>
                        <th>รายการ</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {d.items.map((a) => (
                        <tr key={a.id}>
                          <td>{fmt(a.created_at, true)}</td>
                          <td>{a.actor_name}</td>
                          <td>{a.action}</td>
                          <td>
                            {auditEntities[a.entity] || a.entity} #{a.entity_id}
                          </td>
                          <td>
                            <Button onClick={() => setSelected(a)} icon={Eye}>
                              ดูรายละเอียด
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty title="ไม่พบประวัติที่ตรงกับตัวกรอง" />
              )}
              <Pager
                data={d}
                onPage={(page) => setFilters({ ...filters, page })}
              />
            </>
          )}
        </Resource>
      </section>
      {selected && (
        <Modal
          title="รายละเอียดการเปลี่ยนแปลง"
          onClose={() => setSelected(null)}
          wide
        >
          <p>
            {selected.action} · {selected.actor_name} ·{" "}
            {fmt(selected.created_at, true)}
          </p>
          <AuditChanges entry={selected} />
          {(selected.entity === "activity" ||
            (selected.entity === "news" && isPr)) && (
            <div className="modal-actions">
              <Button
                onClick={() => {
                  navigate(selected.entity + "/" + selected.entity_id);
                  setSelected(null);
                }}
                icon={Link}
              >
                เปิดรายการต้นทาง
              </Button>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
createRoot(document.getElementById("root")).render(<App />);
