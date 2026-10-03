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
  executive: "ผู้บริหารสำนัก",
  pr: "เจ้าหน้าที่ประชาสัมพันธ์",
  admin: "ผู้ดูแลระบบ",
};
const today = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
const monthRange = () => {
  const d = today();
  return { from: d.slice(0, 7) + "-01", to: d };
};
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
          pending: "รอตรวจข้อมูล",
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
      .then(setData)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
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
      : u.roles.includes("head")
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
  if (!user) return <Login onLogin={authenticated} />;
  if (!meta) return <Loading />;
  const canWrite = user.roles.some((r) => ["staff", "head"].includes(r)),
    isPr = user.roles.includes("pr"),
    isAdmin = user.roles.includes("admin");
  const menu = [
    ["dashboard", "แดชบอร์ด", LayoutDashboard],
    ["library", "คลังข้อมูล", FolderOpen],
    ...(canWrite
      ? [
          ["import", "นำเข้าข้อมูล", Upload],
          ["inbox", "รายงานจาก LINE", Inbox],
        ]
      : []),
    ["feed", "ฟีดข่าวภายใน", Newspaper],
    ...(isPr ? [["news", "จัดการข่าว", FileText]] : []),
    ...(isAdmin
      ? [
          ["admin", "ดูแลระบบ", Settings],
          ["audit", "ประวัติการแก้ไข", History],
        ]
      : []),
  ];
  const current = path.split("/")[0],
    view = path.split("/")[1];
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
  if (current === "dashboard" || !current)
    page = <Dashboard mode={view || "overview"} />;
  else if (current === "library") page = <Library />;
  else if (current === "activity") page = <ActivityEditor id={view} />;
  else if (current === "import" && canWrite) page = <ImportPage />;
  else if (current === "inbox" && canWrite) page = <LineInbox />;
  else if (current === "feed") page = <Feed />;
  else if (current === "news" && isPr)
    page = view ? <NewsEditor id={view} /> : <NewsManager />;
  else if (current === "admin" && isAdmin) page = <Admin />;
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
        <a className="brand" href="#dashboard/overview">
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
              className={current === p ? "active" : ""}
              onClick={() =>
                navigate(
                  p === "dashboard"
                    ? landing({
                        ...user,
                        roles: user.roles.filter((r) =>
                          ["staff", "head", "executive"].includes(r),
                        ),
                      }).replace(/^(admin|news)$/, "dashboard/overview")
                    : p,
                )
              }
            >
              <Icon size={20} />
              <span>{title}</span>
              {current === p && <ChevronRight size={15} />}
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
              {menu.find((x) => x[0] === current)?.[1] || "รายละเอียดข้อมูล"}
            </b>
          </div>
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
            placeholder="ค้นหาชื่องาน หรือคำสำคัญ"
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
      {scope && (
        <select
          aria-label="ขอบเขตข้อมูล"
          value={value.mine || ""}
          onChange={(e) => set("mine", e.target.value)}
        >
          <option value="">ข้อมูลทั้งหมด</option>
          <option value="1">ข้อมูลที่ฉันนำเข้า</option>
        </select>
      )}
    </div>
  );
}
function Dashboard({ mode }) {
  const { user, meta, navigate, canWrite } = useApp();
  const [filters, setFilters] = useState({
    ...monthRange(),
    unit: mode === "unit" ? user.scopes[0] || user.unit_id || "" : "",
    mine: mode === "mine" ? "1" : "",
  });
  useEffect(
    () =>
      setFilters({
        ...monthRange(),
        unit: mode === "unit" ? user.scopes[0] || user.unit_id || "" : "",
        mine: mode === "mine" ? "1" : "",
      }),
    [mode],
  );
  const resource = useResource("/dashboard?" + query(filters));
  const recent = useResource("/activities?" + query({ ...filters, limit: 5 }));
  function drill(status = "") {
    sessionStorage.setItem(
      "rm-library-filter",
      JSON.stringify({ ...filters, status }),
    );
    navigate("library");
  }
  return (
    <>
      <Header
        title={
          mode === "mine"
            ? "ข้อมูลที่ฉันนำเข้า"
            : mode === "unit"
              ? "แดชบอร์ดหน่วยงาน"
              : "ภาพรวมสำนัก"
        }
        description="ข้อมูลการปฏิบัติงานที่บันทึกแล้ว เพื่อการตรวจสอบและสรุปผลร่วมกัน"
        action={
          canWrite && (
            <div className="actions">
              <Button
                icon={FileText}
                onClick={() => {
                  sessionStorage.removeItem("rm-new-evidence");
                  navigate("activity/new");
                }}
              >
                เพิ่มรายการงาน
              </Button>
              <Button primary icon={Plus} onClick={() => navigate("import")}>
                นำเข้าข้อมูล
              </Button>
            </div>
          )
        }
      />
      <Tabs
        items={[
          ["overview", "ภาพรวมสำนัก"],
          ["unit", "ข้อมูลหน่วยงาน"],
          ["mine", "ข้อมูลที่ฉันนำเข้า"],
        ]}
        value={mode}
        onChange={(m) => navigate("dashboard/" + m)}
      />
      <Filters
        value={filters}
        onChange={setFilters}
        search={false}
        scope={false}
      />
      <Resource resource={resource}>
        {(d) => (
          <>
            <div className="stats">
              <button className="stat featured" onClick={() => drill("ready")}>
                <div>
                  <span>กิจกรรมที่พร้อมสรุป</span>
                  <Activity size={23} />
                </div>
                <strong>
                  {num(d.ready)}
                  <small>กิจกรรม</small>
                </strong>
                <p>
                  <CheckCircle2 size={14} />
                  ตรวจข้อมูลพร้อมนำไปสรุปแล้ว
                </p>
              </button>
              <button className="stat" onClick={() => drill("pending")}>
                <div>
                  <span>รายการรอตรวจข้อมูล</span>
                  <Clock size={23} />
                </div>
                <strong>
                  {num(d.pending)}
                  <small>รายการ</small>
                </strong>
                <p>ยังไม่รวมในยอดกิจกรรมที่พร้อมสรุป</p>
              </button>
              <button
                className="stat"
                onClick={() => {
                  sessionStorage.setItem("rm-library-tab", "files");
                  navigate("library");
                }}
              >
                <div>
                  <span>ไฟล์ที่ฝากเก็บ</span>
                  <FolderOpen size={23} />
                </div>
                <strong>
                  {num(d.archives)}
                  <small>ไฟล์</small>
                </strong>
                <p>เอกสารอ้างอิง แยกจากจำนวนกิจกรรม</p>
              </button>
              <div className="stat">
                <div>
                  <span>หน่วยงานที่มีรายงาน</span>
                  <Building2 size={23} />
                </div>
                <strong>
                  {num(d.byUnit.length)}
                  <small>หน่วยงาน</small>
                </strong>
                <p>ตามช่วงเวลาที่เลือก</p>
              </div>
            </div>
            <div className="dashboard-charts">
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>กิจกรรมรายเดือน</h2>
                    <p>จำนวนกิจกรรมที่พร้อมสรุป · หน่วย: กิจกรรม</p>
                  </div>
                  <Badge>ข้อมูลจริง</Badge>
                </div>
                {d.months.length ? (
                  <div className="bar-chart">
                    {d.months.map((m) => (
                      <div className="bar-column" key={m.name}>
                        <b>{m.count}</b>
                        <div className="bar-track">
                          <span
                            style={{
                              height: `${Math.max(3, (m.count / Math.max(...d.months.map((x) => x.count))) * 100)}%`,
                            }}
                          />
                        </div>
                        <small>{fmt(m.name + "-01").replace(/^1 /, "")}</small>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty title="ยังไม่มีกิจกรรมพร้อมสรุป" />
                )}
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>กิจกรรมแยกตามประเภทงาน</h2>
                    <p>นับรายการงาน ไม่ใช่ข้อความหรือรูปภาพ</p>
                  </div>
                </div>
                {d.byCategory.length ? (
                  <div className="horizontal-chart">
                    {d.byCategory.map((r, i) => (
                      <div key={r.name}>
                        <span>
                          {r.name}
                          <b>{num(r.count)}</b>
                        </span>
                        <div>
                          <i
                            style={{
                              width: `${(r.count / d.ready) * 100}%`,
                              background: [
                                "#0285c7",
                                "#146c64",
                                "#d7ad52",
                                "#6a7cb9",
                              ][i % 4],
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty title="ยังไม่มีข้อมูลประเภทงาน" />
                )}
              </section>
            </div>
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>ผลการดำเนินงานแยกตามหน่วยนับ</h2>
                  <p>
                    รวมเฉพาะชื่อผลและหน่วยนับเดียวกัน โดยไม่จัดอันดับหน่วยงาน
                  </p>
                </div>
              </div>
              {d.metrics.length ? (
                <div className="metric-grid">
                  {d.metrics.map((m) => (
                    <button
                      key={m.label + m.unit}
                      onClick={() => drill("ready")}
                    >
                      <span>{m.label}</span>
                      <strong>
                        {num(m.value)} <small>{m.unit}</small>
                      </strong>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="subtle-empty">
                  ยังไม่มีผลการดำเนินงานที่พร้อมสรุป
                </div>
              )}
            </section>
            <p className="updated">
              <Clock size={14} />
              อัปเดตข้อมูลล่าสุด:{" "}
              {d.updatedAt ? fmt(d.updatedAt, true) : "ยังไม่มีข้อมูล"}
            </p>
          </>
        )}
      </Resource>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>รายการงานล่าสุด</h2>
            <p>เปิดรายการเพื่อตรวจสอบหลักฐานต้นทาง</p>
          </div>
          <Button onClick={() => drill()} icon={ArrowRight}>
            ดูทั้งหมด
          </Button>
        </div>
        <Resource resource={recent}>
          {(d) => <WorkTable rows={d.items} />}
        </Resource>
      </section>
      <Notice>
        ไฟล์ฝากเก็บและรายการรอตรวจไม่รวมในยอดกิจกรรม
        ผู้รายงานหรือผู้นำเข้าอาจรายงานแทนผู้ปฏิบัติงานหลายคนได้
      </Notice>
    </>
  );
}
function WorkTable({ rows }) {
  const { navigate } = useApp();
  if (!rows.length)
    return (
      <Empty
        title="ไม่พบรายการงาน"
        children="ลองเปลี่ยนตัวกรอง หรือนำเข้าข้อมูลเพื่อสร้างรายการงาน"
      />
    );
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>ชื่องาน / วันที่ปฏิบัติงาน</th>
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
                <Badge status={r.status} />
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
  const resource = useResource("/" + tab + "?" + query(filters));
  return (
    <>
      <Header
        title="คลังข้อมูล"
        description="ค้นหาเอกสาร รายการงาน และหลักฐานต้นทางที่จัดเก็บไว้ส่วนกลาง"
        action={
          canWrite && (
            <Button primary icon={Plus} onClick={() => navigate("import")}>
              นำเข้าข้อมูล
            </Button>
          )
        }
      />
      <Tabs
        items={[
          ["activities", "รายการงาน"],
          ["files", "ไฟล์และเอกสาร"],
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
        dates={tab === "activities"}
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
            <option value="pending">รอตรวจข้อมูล</option>
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
      {preview && (
        <FilePreview file={preview} onClose={() => setPreview(null)} />
      )}
    </>
  );
}
function FilePreview({ file, onClose }) {
  return (
    <Modal title={file.title || file.original_name} onClose={onClose} wide>
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
      ) : (
        <Empty title="ดาวน์โหลดเพื่อเปิดในโปรแกรม Excel" />
      )}
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
  const { meta, user, navigate, notify } = useApp();
  const [step, setStep] = useState(1),
    [files, setFiles] = useState([]),
    [purpose, setPurpose] = useState("archive"),
    [unit, setUnit] = useState(user.unit_id || user.scopes[0] || ""),
    [keywords, setKeywords] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [progress, setProgress] = useState(0);
  const completed = useRef(new Map());
  const writableUnits = meta.units.filter(
    (u) =>
      u.active &&
      ((user.roles.includes("staff") && u.id === user.unit_id) ||
        (user.roles.includes("head") && user.scopes.includes(u.id))),
  );
  function choose(list) {
    const next = Array.from(list);
    if (
      next.some(
        (f) =>
          f.size > 20 * 1024 * 1024 ||
          !/\.(pdf|xlsx?|png|jpe?g|webp)$/i.test(f.name),
      )
    ) {
      setError("รองรับ PDF, Excel และรูปภาพ ขนาดไม่เกิน 20 MB ต่อไฟล์");
      return;
    }
    if (next.length > 10) {
      setError("เลือกได้ไม่เกิน 10 ไฟล์ต่อครั้ง");
      return;
    }
    setFiles(next);
    completed.current.clear();
    setError("");
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      const ids = [];
      for (let i = 0; i < files.length; i++) {
        let id = completed.current.get(files[i]);
        if (!id) {
          const body = new FormData();
          body.append("file", files[i]);
          body.append("purpose", purpose);
          body.append("unit_id", unit);
          body.append("keywords", keywords);
          const result = await api("/files", { method: "POST", body });
          id = result.id;
          completed.current.set(files[i], id);
        }
        ids.push(id);
        setProgress(i + 1);
      }
      notify(`จัดเก็บไฟล์ ${ids.length} ไฟล์แล้ว`);
      if (purpose === "evidence") {
        sessionStorage.setItem(
          "rm-new-evidence",
          JSON.stringify({ file_ids: ids, unit_id: Number(unit) }),
        );
        navigate("activity/new");
      } else {
        sessionStorage.setItem("rm-library-tab", "files");
        navigate("library");
      }
    } catch (e) {
      setError(
        e.message + " — ไฟล์ที่สำเร็จถูกเก็บแล้ว กดลองใหม่เพื่อดำเนินการต่อ",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Header
        title="นำเข้าข้อมูล"
        description="เก็บไฟล์ไว้ค้นหา หรือเชื่อมไฟล์เป็นหลักฐานของรายการงาน"
      />
      <div className="steps">
        {["เลือกไฟล์", "เลือกวัตถุประสงค์", "ตรวจข้อมูลและบันทึก"].map(
          (s, i) => (
            <div
              key={s}
              className={step === i + 1 ? "active" : step > i + 1 ? "done" : ""}
            >
              <span>{step > i + 1 ? <Check size={17} /> : i + 1}</span>
              {s}
            </div>
          ),
        )}
      </div>
      <section className="panel import-panel">
        {error && <Notice error>{error}</Notice>}
        {step === 1 ? (
          <>
            <label
              className="dropzone"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                choose(e.dataTransfer.files);
              }}
            >
              <FileUp size={42} />
              <h2>ลากไฟล์มาวางที่นี่</h2>
              <p>หรือเลือกไฟล์จากคอมพิวเตอร์ / โทรศัพท์</p>
              <span className="button primary">เลือกไฟล์</span>
              <small>PDF, Excel, JPG, PNG, WebP · สูงสุด 20 MB ต่อไฟล์</small>
              <input
                aria-label="เลือกไฟล์"
                type="file"
                accept=".pdf,.xlsx,.xls,.jpg,.jpeg,.png,.webp"
                multiple
                onChange={(e) => choose(e.target.files)}
              />
            </label>
            <div className="file-list">
              {files.map((f, i) => (
                <div key={i}>
                  <FileText size={21} />
                  <span>
                    {f.name}
                    <small>{bytes(f.size)}</small>
                  </span>
                  <button
                    className="icon-button"
                    aria-label="ลบไฟล์"
                    onClick={() => setFiles(files.filter((_, j) => j !== i))}
                  >
                    <X size={18} />
                  </button>
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <Button
                primary
                disabled={!files.length}
                onClick={() => setStep(2)}
                icon={ArrowRight}
              >
                ถัดไป
              </Button>
            </div>
          </>
        ) : step === 2 ? (
          <>
            <h2>ต้องการใช้ไฟล์นี้เพื่ออะไร?</h2>
            <div className="choice-list">
              {[
                [
                  "archive",
                  "ฝากไฟล์ไว้ค้นหาและอ้างอิง",
                  "เก็บเอกสารส่วนกลาง โดยไม่เพิ่มจำนวนกิจกรรม",
                  FolderOpen,
                ],
                [
                  "evidence",
                  "จัดข้อมูลเพื่อนำไปสรุปผลงาน",
                  "เชื่อมหลักฐานกับรายการงาน แล้วตรวจข้อมูลก่อนรวมยอด",
                  Activity,
                ],
              ].map(([v, t, d, Icon]) => (
                <button
                  key={v}
                  className={`choice ${purpose === v ? "selected" : ""}`}
                  onClick={() => setPurpose(v)}
                >
                  <Icon size={26} />
                  <div>
                    <h3>{t}</h3>
                    <p>{d}</p>
                  </div>
                  <span className="radio-dot" />
                </button>
              ))}
            </div>
            <div className="modal-actions">
              <Button onClick={() => setStep(1)}>ย้อนกลับ</Button>
              <Button primary onClick={() => setStep(3)} icon={ArrowRight}>
                ถัดไป
              </Button>
            </div>
          </>
        ) : (
          <>
            <h2>ตรวจรายละเอียดก่อนนำเข้า</h2>
            <div className="form">
              <Field label="หน่วยงาน">
                <select
                  value={unit}
                  onChange={(e) => {
                    setUnit(e.target.value);
                    completed.current.clear();
                  }}
                  disabled={busy || completed.current.size > 0}
                >
                  <UnitOptions units={meta.units} allowed={writableUnits} />
                </select>
              </Field>
              <Field label="คำสำคัญ">
                <input
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  placeholder="คำค้นหาสำหรับเอกสาร"
                  disabled={busy}
                />
              </Field>
              <div className="file-list">
                {files.map((f, i) => (
                  <div key={i}>
                    <FileText size={20} />
                    <span>{f.name}</span>
                    {completed.current.has(f) ? (
                      <Badge status="ready">จัดเก็บแล้ว</Badge>
                    ) : (
                      <Badge>รอนำเข้า</Badge>
                    )}
                  </div>
                ))}
              </div>
              <Notice>
                {purpose === "archive"
                  ? "ไฟล์จะถูกจัดเก็บเพื่อค้นหา และไม่ถูกนับเป็นกิจกรรม"
                  : "หลังอัปโหลดจะเปิดแบบฟอร์มให้ตรวจและกรอกข้อมูลจากไฟล์จริง ขณะนี้ยังไม่ได้เชื่อมบริการ AI จึงไม่มีการสกัดข้อมูลอัตโนมัติ"}
              </Notice>
              <div className="modal-actions">
                <Button
                  disabled={busy || completed.current.size > 0}
                  onClick={() => setStep(2)}
                >
                  ย้อนกลับ
                </Button>
                <Button
                  primary
                  disabled={busy || !unit}
                  onClick={save}
                  icon={Upload}
                >
                  {busy
                    ? `กำลังจัดเก็บ ${progress}/${files.length}`
                    : purpose === "archive"
                      ? "บันทึกไฟล์เข้าคลัง"
                      : "จัดเก็บและตรวจข้อมูล"}
                </Button>
              </div>
            </div>
          </>
        )}
      </section>
    </>
  );
}

const blankActivity = (user, extra = {}) => ({
  title: "",
  date: today(),
  unit_id: user.unit_id || user.scopes[0] || "",
  category_id: "",
  work_id: "",
  area: "",
  workers: "",
  result: "",
  metrics: [],
  status: "pending",
  file_ids: [],
  inbox_ids: [],
  ...extra,
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
    [addCategory, setAddCategory] = useState(false);
  const newRef = useRef(null);
  useEffect(() => {
    let alive = true;
    setForm(null);
    setError("");
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
            setForm({ ...r, file_ids: [], inbox_ids: [] });
            setEvidence(r.files);
          }
        })
        .catch((e) => setError(e.message));
    return () => {
      alive = false;
    };
  }, [id]);
  const editable = fresh ? canWrite : record?.can_edit;
  const change = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = {
        ...form,
        unit_id: Number(form.unit_id),
        category_id: form.category_id ? Number(form.category_id) : null,
        work_id: form.work_id ? Number(form.work_id) : null,
        date: form.date || null,
        metrics: form.metrics.map((m) => ({ ...m, value: Number(m.value) })),
      };
      await api("/activities" + (fresh ? "" : "/" + id), {
        method: fresh ? "POST" : "PUT",
        body,
      });
      sessionStorage.removeItem("rm-new-evidence");
      notify("บันทึกรายการงานเรียบร้อยแล้ว");
      navigate("dashboard/mine");
    } catch (e) {
      setError(e.message + (e.details ? " · " + e.details.join(" / ") : ""));
    } finally {
      setBusy(false);
    }
  }
  if (!form) return error ? <Notice error>{error}</Notice> : <Loading />;
  return (
    <>
      <Header
        title={fresh ? "สร้างรายการงาน" : "รายละเอียดและตรวจแก้ข้อมูล"}
        description="ตรวจข้อมูลร่วมกับหลักฐานต้นทาง แยกผู้รายงานออกจากผู้ปฏิบัติงาน"
        action={
          <Button icon={ArrowLeft} onClick={() => navigate("library")}>
            กลับคลังข้อมูล
          </Button>
        }
      />
      <div className="detail-status">
        <Badge status={form.status} />
        <Badge>{editable ? "คุณมีสิทธิ์แก้ไข" : "อ่านอย่างเดียว"}</Badge>
        {record && (
          <span>
            ผู้นำเข้า: {record.owner_name} ·{" "}
            {record.source === "line" ? "LINE" : "เว็บไซต์"}
          </span>
        )}
      </div>
      <div className="detail-grid">
        <section className="panel evidence-panel">
          <div className="panel-heading">
            <div>
              <h2>หลักฐานต้นทาง</h2>
              <p>
                {record?.messages?.length || form.inbox_ids.length} ข้อความ ·{" "}
                {evidence.length} ไฟล์
              </p>
            </div>
            {editable && (
              <Button icon={Plus} onClick={() => setAttach(true)}>
                เชื่อมไฟล์
              </Button>
            )}
          </div>
          {record?.messages?.map((m) => (
            <div className="source-message" key={m.id}>
              <Badge status="line">LINE</Badge>
              <p>{m.text || "รูปภาพ / ไฟล์แนบ"}</p>
              <small>{fmt(m.received_at, true)}</small>
            </div>
          ))}
          {evidence.length ? (
            <div className="evidence-list">
              {evidence.map((f) => (
                <button key={f.id} onClick={() => setPreview(f)}>
                  {f.mime.startsWith("image/") ? (
                    <img src={fileUrl(f.id)} alt={f.title} />
                  ) : (
                    <FileText size={40} />
                  )}
                  <span>{f.title || f.original_name}</span>
                  <small>{bytes(f.size)}</small>
                </button>
              ))}
            </div>
          ) : (
            <Empty
              title="ยังไม่มีไฟล์หลักฐาน"
              children="เชื่อมไฟล์ที่นำเข้า หรืออ้างอิงข้อความ LINE ของกิจกรรมนี้"
            />
          )}
          <Notice>
            ข้อความและไฟล์หลายรายการเชื่อมกับงานเดียวกันได้
            เมื่อพร้อมสรุปจะนับเป็น 1 กิจกรรม
          </Notice>
          {record?.history?.length > 0 && (
            <div className="history-list">
              <h3>ประวัติรายการ</h3>
              {record.history.map((h, i) => (
                <p key={i}>
                  {h.action} · {h.actor_name}
                  <small>{fmt(h.created_at, true)}</small>
                </p>
              ))}
            </div>
          )}
        </section>
        <section className="panel form-panel">
          <h2>ข้อมูลรายการงาน</h2>
          <form className="form" onSubmit={save}>
            <fieldset disabled={!editable || busy}>
              <Field label="ชื่องาน *">
                <input
                  required
                  maxLength={300}
                  value={form.title}
                  onChange={(e) => change("title", e.target.value)}
                />
              </Field>
              <div className="form-row">
                <Field label="วันที่ปฏิบัติงาน">
                  <input
                    type="date"
                    value={form.date || ""}
                    onChange={(e) => change("date", e.target.value)}
                    required={form.status === "ready"}
                  />
                </Field>
                <Field label="ฝ่าย/กลุ่มงาน *">
                  <select
                    value={form.unit_id}
                    required
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        unit_id: Number(e.target.value),
                        work_id: "",
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
                              (user.roles.includes("head") &&
                                user.scopes.includes(u.id)))),
                      )}
                    />
                  </select>
                </Field>
              </div>
              <Field label="งานตามฝ่าย/กลุ่มงาน">
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
              </Field>
              <div className="form-row">
                <div className="category-control">
                  <Field label="ประเภทงาน">
                    <select
                      value={form.category_id || ""}
                      onChange={(e) => change("category_id", e.target.value)}
                      required={form.status === "ready"}
                    >
                      <option value="">ไม่พบข้อมูล / ยังไม่ระบุ</option>
                      {meta.categories
                        .filter((c) => c.active || c.id === form.category_id)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                  {editable && (
                    <Button
                      type="button"
                      className="add-category"
                      icon={Plus}
                      onClick={() => setAddCategory(true)}
                    >
                      เพิ่มประเภทงาน
                    </Button>
                  )}
                </div>
                <Field label="พื้นที่">
                  <input
                    value={form.area}
                    placeholder="ไม่พบข้อมูล"
                    onChange={(e) => change("area", e.target.value)}
                    required={form.status === "ready"}
                  />
                </Field>
              </div>
              <Field label="ผู้ปฏิบัติงานตามข้อมูลต้นทาง">
                <textarea
                  rows={2}
                  value={form.workers}
                  placeholder="ไม่พบข้อมูล"
                  onChange={(e) => change("workers", e.target.value)}
                  required={form.status === "ready"}
                />
              </Field>
              <Field label="ผลการดำเนินงาน">
                <textarea
                  rows={4}
                  value={form.result}
                  placeholder="กรอกผลตามหลักฐานต้นทาง"
                  onChange={(e) => change("result", e.target.value)}
                  required={form.status === "ready"}
                />
              </Field>
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
                    {[
                      "กิจกรรม",
                      "ครั้ง",
                      "ครั้งบริการ",
                      "คน",
                      "ตัน",
                      "หลังคาเรือน",
                      "แห่ง",
                      "กิโลกรัม",
                    ].map((u) => (
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
              <Field label="สถานะข้อมูล">
                <select
                  value={form.status}
                  onChange={(e) => change("status", e.target.value)}
                >
                  <option value="pending">รอตรวจข้อมูล — ยังไม่รวมยอด</option>
                  <option value="ready">พร้อมสรุป — ข้อมูลครบตามต้นทาง</option>
                </select>
              </Field>
              {error && <Notice error>{error}</Notice>}
              {editable && (
                <Button primary disabled={busy} icon={Save}>
                  {busy ? "กำลังบันทึก…" : "บันทึกข้อมูล"}
                </Button>
              )}
            </fieldset>
          </form>
        </section>
      </div>
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
          onClose={() => setAttach(false)}
          onPick={(f) => {
            if (!evidence.some((x) => x.id === f.id)) {
              setEvidence([...evidence, f]);
              change("file_ids", [...form.file_ids, f.id]);
            }
            setAttach(false);
          }}
        />
      )}
    </>
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
function AttachmentPicker({ onClose, onPick }) {
  const r = useResource("/files?purpose=evidence&unlinked=1&mine=1&limit=100");
  return (
    <Modal title="เชื่อมไฟล์หลักฐานที่นำเข้า" onClose={onClose}>
      <Resource resource={r}>
        {(d) =>
          d.items.length ? (
            <div className="file-list">
              {d.items.map((f) => (
                <button key={f.id} onClick={() => onPick(f)}>
                  <FileText size={20} />
                  <span>{f.title}</span>
                  <Plus size={18} />
                </button>
              ))}
            </div>
          ) : (
            <Empty
              title="ไม่มีไฟล์หลักฐานที่ยังไม่เชื่อม"
              children="นำเข้าไฟล์โดยเลือกจัดข้อมูลเพื่อสรุปผลงานก่อน"
            />
          )
        }
      </Resource>
    </Modal>
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
      {!meta.line.receiveConfigured && (
        <Notice>
          ยังไม่ได้ตั้งค่า LINE webhook
          ระบบจะแสดงรายงานที่ได้รับจริงหลังผู้ดูแลเชื่อมต่อช่องทางแล้ว
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
      ? "/activities?status=ready&limit=10&page=" + page
      : "/news?status=" + tab + "&page=" + page,
  );
  return (
    <>
      <Header
        title="จัดการข่าวประชาสัมพันธ์"
        description="เลือกข้อมูลจากรายงานจริง จัดทำข่าว และยืนยันก่อนเผยแพร่"
      />
      <Tabs
        items={[
          ["source", "เลือกรายงานต้นทาง"],
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
                    <article key={n.id}>
                      <div className="news-list-icon">
                        <Newspaper size={27} />
                      </div>
                      <div>
                        <Badge status={tab === "source" ? "ready" : n.status}>
                          {tab === "source" ? "รายงานพร้อมสรุป" : undefined}
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
                                (tab === "source" ? n.id : n.activity_id),
                            )
                          }
                          icon={FileText}
                        >
                          ดูต้นทาง
                        </Button>
                        <Button
                          primary
                          onClick={() =>
                            navigate(
                              "news/" +
                                (tab === "source"
                                  ? "new?activity=" + n.id
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
              <Pager data={d} onPage={setPage} />
            </>
          )}
        </Resource>
      </section>
      <Notice>
        ข่าวฉบับเผยแพร่เป็นข้อมูลแยกจากรายงานต้นทาง และไม่มีการเผยแพร่อัตโนมัติ
        ขณะนี้เลือกต้นทางด้วยเจ้าหน้าที่ได้ โดยยังไม่ได้เชื่อมบริการ AI เสนอข่าว
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
    [preview, setPreview] = useState(false);
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
        if (alive) {
          setSource(activity);
          setForm(
            news || {
              activity_id: activityId,
              title: activity.title,
              body: "",
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
        body: { version: saved.version },
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

function Admin() {
  const [tab, setTab] = useState("users");
  return (
    <>
      <Header
        title="ดูแลระบบ"
        description="จัดการบัญชี บทบาท ขอบเขตหน่วยงาน และการเชื่อมต่อข้อมูล"
      />
      <Tabs
        items={[
          ["users", "ผู้ใช้และสิทธิ์"],
          ["master", "หน่วยงานและหมวดข้อมูล"],
          ["line", "การเชื่อมต่อ LINE"],
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "users" ? (
        <UsersAdmin />
      ) : tab === "master" ? (
        <MasterAdmin />
      ) : (
        <LineAdmin />
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
            <p>หนึ่งบัญชีมีได้หลายบทบาท</p>
          </div>
          <Button
            primary
            icon={Plus}
            onClick={() =>
              setEditing({
                username: "",
                name: "",
                unit_id: "",
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
                    <th>สังกัด</th>
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
                      <td>{u.unit_name || "ส่วนกลาง"}</td>
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
        บทบาทผู้ดูแลระบบไม่ให้สิทธิ์แก้รายงานทั้งหมด
        การแก้ไขงานขึ้นกับเจ้าของรายการและหน่วยงานที่หัวหน้ารับผิดชอบ
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
  const [form, setForm] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const set = (k, v) => setForm({ ...form, [k]: v });
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        ...form,
        unit_id: form.unit_id ? Number(form.unit_id) : null,
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
        <Field label="สังกัด">
          <select
            value={form.unit_id || ""}
            onChange={(e) => set("unit_id", e.target.value)}
          >
            <option value="">ส่วนกลาง / ไม่ระบุ</option>
            <UnitOptions
              units={meta.units}
              allowed={meta.units.filter(
                (u) => u.active || u.id === form.unit_id,
              )}
            />
          </select>
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
              <h2>ส่วน ฝ่าย/กลุ่มงาน และงาน</h2>
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
  const r = useResource("/admin/line");
  return (
    <Resource resource={r}>
      {(d) => (
        <>
          <div className="master-grid">
            {[
              [d.receiveConfigured, "ช่องทางรับรายงาน", d.lastReceived],
              [d.sendConfigured, "กลุ่มส่งข่าวที่อนุมัติแล้ว", d.lastSent],
            ].map(([ready, title, last]) => (
              <section className="panel form-panel" key={title}>
                <div className="connection-icon">
                  <Link size={27} />
                </div>
                <h2>{title}</h2>
                <Badge status={ready ? "ready" : "pending"}>
                  {ready ? "ตั้งค่าช่องทางแล้ว" : "ยังไม่ได้ตั้งค่า"}
                </Badge>
                <p className="muted">
                  ข้อมูลล่าสุด: {last ? fmt(last, true) : "ยังไม่มีข้อมูล"}
                </p>
              </section>
            ))}
          </div>
          <Notice>
            ตั้งค่า Channel secret, Access token และ Group ID ในไฟล์ .env
            บนเซิร์ฟเวอร์ แล้วเริ่มระบบใหม่ โดย webhook ต้องเป็น HTTPS ที่ LINE
            เข้าถึงได้: <code>{d.webhookPath}</code>
            <br />
            สถานะ “ตั้งค่าช่องทางแล้ว” หมายถึงมีค่าตั้งค่า ยังไม่ใช่การยืนยันว่า
            LINE ติดต่อสำเร็จ
          </Notice>
          {d.unmappedUsers.length > 0 && (
            <section className="panel form-panel">
              <h2>ผู้รายงานที่ยังไม่ได้ผูกบัญชี</h2>
              <p>คัดลอก ID ไปกำหนดในบัญชีผู้ใช้งานที่ตรงกับผู้รายงาน</p>
              {d.unmappedUsers.map((u) => (
                <p key={u.line_user_id}>
                  <code>{u.line_user_id}</code>
                </p>
              ))}
            </section>
          )}
        </>
      )}
    </Resource>
  );
}
function Audit() {
  const [filters, setFilters] = useState({ page: 1 }),
    [selected, setSelected] = useState(null);
  const { navigate } = useApp();
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
                            {{
                              activity: "รายการงาน",
                              news: "ข่าว",
                              user: "บัญชี",
                              file: "ไฟล์",
                              units: "หน่วยงาน",
                              categories: "หมวดข้อมูล",
                            }[a.entity] || a.entity}{" "}
                            #{a.entity_id}
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
          <div className="audit-diff">
            {[
              ["ค่าเดิม", selected.before_json],
              ["ค่าใหม่", selected.after_json],
            ].map(([title, json]) => (
              <div key={title}>
                <h3>{title}</h3>
                <pre>
                  {json
                    ? JSON.stringify(JSON.parse(json), null, 2)
                    : "ไม่มีข้อมูล"}
                </pre>
              </div>
            ))}
          </div>
          {["activity", "news"].includes(selected.entity) && (
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
