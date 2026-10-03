import React from "react";

export function UnitOptions({ units, allowed = units }) {
  const rows = allowed.filter((u) => u.kind !== "section");
  const groups = new Map();
  for (const unit of rows) {
    const label =
      units.find((u) => u.id === unit.parent_id)?.name || "สังกัดสำนักโดยตรง";
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(unit);
  }
  return [...groups].map(([label, items]) => (
    <optgroup key={label} label={label}>
      {items.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name}
          {!u.active ? " (ปิดใช้)" : ""}
        </option>
      ))}
    </optgroup>
  ));
}

export function WorkOptions({ works, unitId, selected }) {
  const rows = works.filter((w) => w.unit_id === Number(unitId));
  function label(work, seen = new Set()) {
    if (!work.parent_id || seen.has(work.id)) return work.name;
    seen.add(work.id);
    const parent = rows.find((w) => w.id === work.parent_id);
    return parent ? `${label(parent, seen)} › ${work.name}` : work.name;
  }
  return rows
    .filter((w) => w.active || w.id === Number(selected))
    .map((w) => (
      <option key={w.id} value={w.id}>
        {label(w)}
        {!w.active ? " (ปิดใช้)" : ""}
      </option>
    ));
}
