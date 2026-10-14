const { isDeepStrictEqual: same } = require("node:util");
const { randomUUID } = require("node:crypto");
const collections = ["clips", "titles", "captions", "markers"];
function changes(before, after) {
  const result = [];
  for (const key of new Set([
    ...Object.keys(before || {}),
    ...Object.keys(after || {}),
  ])) {
    if (["version", ...collections].includes(key)) continue;
    if (!same(before?.[key], after?.[key]))
      result.push({ key, before: before?.[key], after: after?.[key] });
  }
  for (const key of collections) {
    const a = new Map((before?.[key] || []).map((x) => [x.id, x])),
      b = new Map((after?.[key] || []).map((x) => [x.id, x]));
    for (const id of new Set([...a.keys(), ...b.keys()])) {
      const previous = a.get(id),
        next = b.get(id);
      if (same(previous, next)) continue;
      if (!previous || !next)
        result.push({
          key,
          id,
          before: previous,
          after: next,
          beforeIndex: (before?.[key] || []).findIndex((x) => x.id === id),
          afterIndex: (after?.[key] || []).findIndex((x) => x.id === id),
        });
      else
        for (const field of new Set([
          ...Object.keys(previous),
          ...Object.keys(next),
        ])) {
          if (same(previous[field], next[field])) continue;
          result.push({
            key,
            id,
            field,
            before: previous[field],
            after: next[field],
          });
        }
    }
  }
  return result;
}
function recordSequence(project, before, after, metadata = {}) {
  const baseline = before || {
    ...after,
    clips: [],
    titles: [],
    captions: [],
    markers: [],
  };
  const diff = changes(baseline, after);
  if (!diff.length) return;
  const record = {
    id: typeof metadata.id === "string" ? metadata.id : randomUUID(),
    sequenceId: after.id,
    label: String(metadata.label || "Modification du montage").slice(0, 250),
    source: ["manual", "text", "voice", "recipe"].includes(metadata.source)
      ? metadata.source
      : "manual",
    created: Date.now(),
    updated: Date.now(),
    state: "done",
    count: diff.length,
    createdSequence: !before,
    changes: diff,
  };
  project.commands ||= [];
  project.commands.push(record);
  // Bound the in-catalogue history; project snapshots remain separately available.
  if (project.commands.length > 500)
    project.commands.splice(0, project.commands.length - 500);
  return record;
}
function restoreSequence(project, id, redo, validate) {
  const command = project.commands?.find((c) => c.id === id);
  if (!command)
    throw Error("Commande introuvable dans l’historique du montage.");
  if ((command.state === "undone") !== !!redo)
    throw Error("Cette commande est déjà dans cet état.");
  const current = project.sequences.find((s) => s.id === command.sequenceId);
  if (!current) throw Error("Séquence introuvable.");
  const next = structuredClone(current);
  // Validate all expectations before changing anything, preserving concurrent manual edits.
  // Le message dit d'abord que rien n'a changé : le pilote le rend tel quel
  // au lieu d'une panne (history.ts, `nothingRestored`).
  for (const c of command.changes) {
    const entity = c.id ? next[c.key].find((x) => x.id === c.id) : undefined;
    const value = c.id ? (c.field ? entity?.[c.field] : entity) : next[c.key];
    if (!same(value, redo ? c.before : c.after))
      throw Error(
        `Rien n’a été ${redo ? "rétabli" : "annulé"} : le montage a été repris après ${redo ? "l’annulation de " : ""}« ${command.label} ». Vos modifications sont conservées ; utilisez une version de secours pour revenir plus loin.`,
      );
  }
  for (const c of command.changes) {
    const value = structuredClone(redo ? c.after : c.before);
    if (c.id) {
      const index = next[c.key].findIndex((x) => x.id === c.id);
      if (c.field) {
        if (value === undefined) delete next[c.key][index][c.field];
        else next[c.key][index][c.field] = value;
      } else if (value === undefined) next[c.key].splice(index, 1);
      else if (index === -1)
        next[c.key].splice(
          Math.max(
            0,
            redo
              ? (c.afterIndex ?? next[c.key].length)
              : (c.beforeIndex ?? next[c.key].length),
          ),
          0,
          value,
        );
      else next[c.key][index] = value;
    } else if (value === undefined) delete next[c.key];
    else next[c.key] = value;
  }
  if (command.createdSequence && !redo) {
    // Undo a generated version by clearing its contents, retaining its identity for redo.
    for (const k of [
      "id",
      "name",
      "fps",
      "width",
      "height",
      "masterGain",
      "buses",
      "created",
    ])
      next[k] = current[k];
  }
  validate(next);
  next.version = (current.version || 1) + 1;
  project.sequences[project.sequences.indexOf(current)] = next;
  project.revision++;
  project.updated = Date.now();
  command.state = redo ? "done" : "undone";
  command.updated = Date.now();
  return { sequence: next, revision: project.revision };
}
module.exports = { changes, recordSequence, restoreSequence };
