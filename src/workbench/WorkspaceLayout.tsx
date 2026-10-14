import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Maximize2, PanelRight, Settings2, Search } from "lucide-react";

type Layout = {
  inspector: boolean;
  filmstrip: boolean;
  library: boolean;
  focus: boolean;
  inspectorWidth: number;
  libraryWidth: number;
};
const defaults: Layout = {
  inspector: true,
  filmstrip: true,
  library: false,
  focus: false,
  inspectorWidth: 300,
  libraryWidth: 260,
};
export function readLayout(value: string | null): Layout {
  try {
    const v = JSON.parse(value || "{}");
    const width = (n: unknown, fallback: number) =>
      typeof n === "number" && Number.isFinite(n)
        ? Math.max(240, Math.min(480, n))
        : fallback;
    return {
      ...defaults,
      ...Object.fromEntries(
        ["inspector", "filmstrip", "library", "focus"].map((k) => [
          k,
          typeof v?.[k] === "boolean" ? v[k] : defaults[k as keyof Layout],
        ]),
      ),
      inspectorWidth: width(v?.inspectorWidth, 300),
      libraryWidth: width(v?.libraryWidth, 260),
    };
  } catch {
    return { ...defaults };
  }
}
export function useWorkspaceLayout(domain: "photo" | "video") {
  const key = "juno-layout-" + domain;
  const [layout, setLayout] = useState(() =>
    readLayout(localStorage.getItem(key)),
  );
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(layout));
  }, [key, layout]);
  const patch = (value: Partial<Layout>) =>
    setLayout((v) => ({ ...v, ...value }));
  const style = {
    "--inspector-width": `${layout.inspectorWidth}px`,
    "--library-width": `${layout.libraryWidth}px`,
  } as CSSProperties;
  return { layout, patch, style, reset: () => setLayout({ ...defaults }) };
}
export type WorkspaceLayout = ReturnType<typeof useWorkspaceLayout>;
export function WorkspaceControls({
  workspace,
  domain,
  onCommands,
  inspectorVisible,
  onInspector,
}: {
  workspace: WorkspaceLayout;
  domain: "photo" | "video";
  onCommands: () => void;
  inspectorVisible?: boolean;
  onInspector?: (visible: boolean) => void;
}) {
  const { layout, patch } = workspace;
  const visible = inspectorVisible ?? layout.inspector;
  const toggleInspector = (value: boolean) =>
    onInspector
      ? onInspector(value)
      : patch({ inspector: value, focus: false });
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: Event) => {
      if (event.type === "keydown" && (event as KeyboardEvent).key !== "Escape")
        return;
      if (
        event.type === "pointerdown" &&
        menu.current?.contains(event.target as Node)
      )
        return;
      if (menu.current) menu.current.open = false;
    };
    window.addEventListener("keydown", close);
    window.addEventListener("pointerdown", close);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("pointerdown", close);
    };
  }, []);
  return (
    <div className="workspace-controls">
      <button
        aria-label="Rechercher une action"
        title="Accès rapide · ⌘/Ctrl K"
        onClick={onCommands}
      >
        <Search size={16} />
      </button>
      <button
        aria-label="Afficher les réglages"
        title="Afficher ou masquer les réglages"
        aria-pressed={visible && !layout.focus}
        onClick={() => toggleInspector(!visible)}
      >
        <PanelRight size={16} />
      </button>
      <button
        aria-label="Mode concentration"
        aria-pressed={layout.focus}
        title="Agrandir l’espace de travail"
        onClick={() => patch({ focus: !layout.focus })}
      >
        <Maximize2 size={16} />
      </button>
      <details className="workspace-menu" ref={menu}>
        <summary
          aria-label="Organiser l’espace de travail"
          title="Organiser l’espace de travail"
        >
          <Settings2 size={16} />
        </summary>
        <div className="workspace-menu-content">
          <b>Espace de travail</b>
          <label>
            <input
              type="checkbox"
              checked={visible}
              onChange={(e) => toggleInspector(e.target.checked)}
            />{" "}
            Réglages
          </label>
          {domain === "photo" ? (
            <label>
              <input
                type="checkbox"
                checked={layout.filmstrip}
                onChange={(e) => patch({ filmstrip: e.target.checked })}
              />{" "}
              Bande de photos
            </label>
          ) : (
            <label>
              <input
                type="checkbox"
                checked={layout.library}
                onChange={(e) =>
                  patch({ library: e.target.checked, focus: false })
                }
              />{" "}
              Bibliothèque
            </label>
          )}
          <label>
            Largeur des réglages
            <input
              aria-label="Largeur des réglages"
              type="number"
              min={240}
              max={480}
              step={10}
              value={layout.inspectorWidth}
              onChange={(e) => {
                if (e.target.value)
                  patch({
                    inspectorWidth: Math.max(
                      240,
                      Math.min(480, Number(e.target.value)),
                    ),
                  });
              }}
            />
          </label>
          <button onClick={workspace.reset}>Rétablir l’affichage</button>
          <small>Votre disposition est conservée pour cet espace.</small>
        </div>
      </details>
    </div>
  );
}
export function PanelResize({
  width,
  onChange,
  side = "right",
}: {
  width: number;
  onChange: (width: number) => void;
  side?: "left" | "right";
}) {
  const cleanup = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => cleanup.current?.(), []);
  return (
    <div
      className={`panel-resize panel-resize-${side}`}
      role="separator"
      aria-label={
        side === "right" ? "Largeur des réglages" : "Largeur de la bibliothèque"
      }
      aria-orientation="vertical"
      aria-valuemin={240}
      aria-valuemax={480}
      aria-valuenow={width}
      tabIndex={0}
      onKeyDown={(e) => {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
          e.preventDefault();
          const delta =
            (e.key === "ArrowLeft" ? -10 : 10) * (side === "right" ? -1 : 1);
          onChange(
            e.key === "Home"
              ? 240
              : e.key === "End"
                ? 480
                : Math.max(240, Math.min(480, width + delta)),
          );
        }
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        cleanup.current?.();
        const x = e.clientX;
        const move = (p: PointerEvent) =>
          onChange(
            Math.max(
              240,
              Math.min(
                480,
                width + (p.clientX - x) * (side === "right" ? -1 : 1),
              ),
            ),
          );
        const end = () => cleanup.current?.();
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end, { once: true });
        window.addEventListener("pointercancel", end, { once: true });
        cleanup.current = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", end);
          window.removeEventListener("pointercancel", end);
          cleanup.current = undefined;
        };
      }}
    />
  );
}
