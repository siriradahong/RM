let csrf = "";
export function setCsrf(value) {
  csrf = value || "";
}
export async function api(path, { method = "GET", body, signal } = {}) {
  const form = body instanceof FormData;
  const response = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    signal,
    headers: {
      ...(!form && body ? { "Content-Type": "application/json" } : {}),
      ...(method !== "GET" ? { "X-CSRF-Token": csrf } : {}),
    },
    body: body ? (form ? body : JSON.stringify(body)) : undefined,
  });
  const result = await response
    .json()
    .catch(() => ({ error: "การตอบกลับจากเซิร์ฟเวอร์ไม่ถูกต้อง" }));
  if (!response.ok) {
    if (
      response.status === 401 &&
      path !== "/auth/login" &&
      path !== "/auth/me"
    )
      window.dispatchEvent(new Event("session-expired"));
    throw Object.assign(new Error(result.error || "ไม่สามารถดำเนินการได้"), {
      status: response.status,
      details: result.details,
    });
  }
  return result;
}
export const query = (values) => {
  const p = new URLSearchParams();
  Object.entries(values).forEach(([k, v]) => {
    if (v !== "" && v !== null && v !== undefined) p.set(k, String(v));
  });
  return p.toString();
};
export const fileUrl = (id, download = false) =>
  `/api/files/${id}/content${download ? "?download=1" : ""}`;
