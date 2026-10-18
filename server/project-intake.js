import { suggestFields } from "./extraction-parser.js";

// Local, evidence-based reading. Unnamed people and ambiguous dates remain empty.
export function prepareProject(source, members) {
  const lines = source
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const titleLine = lines.find((s) =>
    /^(?:ชื่อโครงการ|โครงการ|ชื่อเรื่อง)\s*[:：]/u.test(s),
  );
  const endLine = lines.find((s) =>
    /^(?:สิ้นสุดโครงการ|วันสิ้นสุด|กำหนดสิ้นสุด)\s*[:：]/u.test(s),
  );
  const tasks = [];
  for (const line of lines) {
    // Accept explicit assignment rows only, not incidental names in narrative.
    if (
      !line.includes("|") &&
      !(
        /^(?:[-•*]|\d+[.)]|งาน\s*[:：])/u.test(line) &&
        /ผู้รับผิดชอบ|มอบหมายให้|โดย/u.test(line)
      )
    )
      continue;
    if (/ชื่อโครงการ|ผู้รับผิดชอบ\s*\|\s*(?:วันที่|กำหนด)/u.test(line))
      continue;
    const parts = line.split("|").map((s) => s.trim());
    const recipients =
      parts.length > 1
        ? parts
            .slice(1)
            .map((s) => s.replace(/^ผู้รับผิดชอบ\s*[:：]?\s*/u, "").trim())
        : [];
    const matched = members.filter((m) =>
      parts.length > 1
        ? recipients.includes(m.name)
        : line.includes("ผู้รับผิดชอบ: " + m.name) ||
          line.includes("ผู้รับผิดชอบ " + m.name) ||
          line.includes("มอบหมายให้ " + m.name) ||
          line.includes("โดย " + m.name),
    );
    let taskTitle = parts[0].replace(/^(?:[-•*]|\d+[.)]|งาน\s*[:：])\s*/u, "");
    if (parts.length === 1)
      taskTitle = taskTitle
        .split(/(?:ผู้รับผิดชอบ|มอบหมายให้|โดย)\s*[:：]?/u)[0]
        .trim();
    if (!taskTitle || taskTitle.length > 300) continue;
    const dates = suggestFields(line);
    const times = [
      ...line.matchAll(
        /\b([01]\d|2[0-3])[:.]([0-5]\d)\s*[-–]\s*([01]\d|2[0-3])[:.]([0-5]\d)\b/g,
      ),
    ];
    const time = times.length === 1 ? times[0] : null;
    tasks.push({
      title: taskTitle,
      assignee_id: matched.length === 1 ? matched[0].id : null,
      due_date: dates.fields.date || "",
      start_time: time ? `${time[1]}:${time[2]}` : null,
      end_time: time ? `${time[3]}:${time[4]}` : null,
      source_quote: line,
      warnings: [
        ...(matched.length !== 1
          ? ["กรุณาเลือกผู้รับผิดชอบที่ระบุชัดเจน"]
          : []),
        ...(!dates.fields.date ? ["กรุณายืนยันวันที่ของงานนี้"] : []),
      ],
    });
    if (tasks.length === 50) break;
  }
  return {
    title: titleLine?.replace(/^[^:：]+[:：]\s*/u, "").slice(0, 300) || "",
    due_date: endLine ? suggestFields(endLine).fields.date || "" : "",
    tasks,
    warnings: tasks.length
      ? ["อ่านด้วยกติกาในเครื่อง โปรดตรวจชื่อผู้รับผิดชอบและวันก่อนยืนยัน"]
      : [
          "ยังไม่พบรายการงานที่ระบุชัดเจน เพิ่มงานในตารางได้ โดยระบบจะไม่เดาผู้รับผิดชอบ",
        ],
  };
}
