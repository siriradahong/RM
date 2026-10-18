import { activeTemplates, matchTemplate } from "./summary-engine.js";

// Keep absent values absent. A recorded zero is a real value.
export function aggregateMetrics(db, rows) {
  const templates = activeTemplates(db),
    groups = new Map();
  for (const row of rows.filter(
    (r) => r.status === "ready" && !r.duplicate_of,
  )) {
    const metrics =
      typeof row.metrics === "string" ? JSON.parse(row.metrics) : row.metrics;
    const template = matchTemplate(templates, row);
    for (const metric of metrics) {
      const rule = template?.config.metrics.find(
        (m) => m.label === metric.label && m.unit === metric.unit,
      );
      const method = rule?.method || "sum";
      const key = JSON.stringify([metric.label, metric.unit, method]);
      const current = groups.get(key) || {
        label: metric.label,
        unit: metric.unit,
        method,
        value: null,
        source_ids: [],
        template_names: [],
      };
      current.value =
        current.value === null
          ? metric.value
          : method === "max"
            ? Math.max(current.value, metric.value)
            : current.value + metric.value;
      current.source_ids.push(row.id);
      if (template && !current.template_names.includes(template.name))
        current.template_names.push(template.name);
      groups.set(key, current);
    }
  }
  return [...groups.values()].map((m) => ({
    ...m,
    source_ids: [...new Set(m.source_ids)],
  }));
}
