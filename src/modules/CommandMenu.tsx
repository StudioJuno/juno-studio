import { useEffect, useRef, useState } from "react";
import { Search, X, ArrowRight } from "lucide-react";

export type CommandAction = {
  id: string;
  label: string;
  detail?: string;
  keys?: string;
  disabled?: boolean;
  run: () => void;
};
export default function CommandMenu({
  actions,
  onClose,
  dark = false,
}: {
  actions: CommandAction[];
  onClose: () => void;
  dark?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState(""),
    [active, setActive] = useState(0);
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase();
  const found = actions
    .filter(
      (a) =>
        !a.disabled &&
        normalize(a.label + " " + (a.detail || "")).includes(normalize(query)),
    )
    .slice(0, 30);
  const selected = Math.min(active, Math.max(0, found.length - 1));
  const run = (action: CommandAction) => {
    onClose();
    action.run();
  };
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  useEffect(() => {
    ref.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selected, query]);
  return (
    <dialog
      ref={ref}
      className={`command-dialog ${dark ? "dark" : ""}`}
      aria-label="Accès rapide"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="command-content"
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) =>
              Math.max(
                0,
                Math.min(
                  found.length - 1,
                  i + (e.key === "ArrowDown" ? 1 : -1),
                ),
              ),
            );
          }
          if (
            e.key === "Enter" &&
            e.target instanceof HTMLInputElement &&
            found[selected]
          ) {
            e.preventDefault();
            run(found[selected]);
          }
        }}
      >
        <div className="command-search">
          <Search size={20} />
          <input
            autoFocus
            value={query}
            role="combobox"
            aria-controls="command-results"
            aria-expanded="true"
            aria-activedescendant={
              found.length ? `command-option-${selected}` : undefined
            }
            aria-label="Rechercher une action ou un projet"
            placeholder="Une action, un projet…"
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
          />
          <button aria-label="Fermer l’accès rapide" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div
          id="command-results"
          className="command-results"
          role="listbox"
          aria-label="Actions disponibles"
        >
          {!found.length && (
            <p>
              Aucun résultat. Essayez « exporter », « style » ou le nom d’un
              projet.
            </p>
          )}
          {found.map((action, i) => (
            <button
              id={`command-option-${i}`}
              key={action.id}
              role="option"
              aria-selected={selected === i}
              className={selected === i ? "active" : ""}
              onMouseEnter={() => setActive(i)}
              onClick={() => run(action)}
            >
              <span>
                <b>{action.label}</b>
                {action.detail && <small>{action.detail}</small>}
              </span>
              {action.keys ? (
                <kbd>{action.keys}</kbd>
              ) : (
                <ArrowRight size={15} />
              )}
            </button>
          ))}
        </div>
        <footer>
          <span>↑ ↓ Parcourir · Entrée Ouvrir</span>
          <kbd>Échap Fermer</kbd>
        </footer>
      </div>
    </dialog>
  );
}
