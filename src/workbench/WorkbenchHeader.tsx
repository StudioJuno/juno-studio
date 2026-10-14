import { useEffect, useState, type ReactNode } from "react";
import { FolderOpen, Menu, Moon, Sun, Monitor, X } from "lucide-react";
import { UpdateIndicator } from '../modules/UpdateCenter';
export type Appearance = "system" | "light" | "dark";
export function useAppearance() {
  const [appearance, setAppearance] = useState<Appearance>(() => {
    const value = localStorage.getItem("juno-appearance");
    return value === "light" || value === "dark" ? value : "system";
  });
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        appearance === "system"
          ? media.matches
            ? "dark"
            : "light"
          : appearance;
      document.documentElement.style.colorScheme =
        document.documentElement.dataset.theme!;
    };
    apply();
    media.addEventListener("change", apply);
    localStorage.setItem("juno-appearance", appearance);
    return () => media.removeEventListener("change", apply);
  }, [appearance]);
  return [appearance, setAppearance] as const;
}
export default function WorkbenchHeader({
  domain,
  project,
  drawer,
  onDrawer,
  onPhotos,
  onMedia,
  onVideo,
  onReview,
  disabled,
  children,
  viewControls,
}: {
  domain: "photo" | "video" | "media";
  project: string;
  drawer: boolean;
  onDrawer: () => void;
  onPhotos: () => void;
  onMedia: () => void;
  onVideo: () => void;
  onReview: () => void;
  disabled?: boolean;
  children: ReactNode;
  viewControls?: ReactNode;
}) {
  const [appearance, setAppearance] = useAppearance();
  useEffect(() => {
    if (!drawer) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDrawer();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [drawer, onDrawer]);
  return (
    <header className="workbench-header">
      <div className="workbench-identity">
        <button
          className="project-drawer-toggle"
          aria-label={drawer ? "Fermer les projets" : "Ouvrir les projets"}
          aria-expanded={drawer}
          onClick={onDrawer}
          disabled={disabled}
        >
          {drawer ? <X size={18} /> : <Menu size={18} />} Projets
        </button>
        <span className="workbench-brand">juno</span>
        <span className="workbench-project" title={project}>
          {project || "Votre studio"}
        </span>
        <div className="workbench-services">{children}</div>
        {viewControls}
        <UpdateIndicator />
        <label className="appearance-picker" title="Apparence de Juno">
          {appearance === "light" ? (
            <Sun size={16} />
          ) : appearance === "dark" ? (
            <Moon size={16} />
          ) : (
            <Monitor size={16} />
          )}
          <select
            aria-label="Thème de Juno"
            value={appearance}
            onChange={(e) => setAppearance(e.target.value as Appearance)}
          >
            <option value="system">Système</option>
            <option value="light">Clair</option>
            <option value="dark">Sombre</option>
          </select>
        </label>
      </div>
      <nav className="workbench-navigation" aria-label="Espaces du projet">
        <button
          aria-current={domain === "media" ? "page" : undefined}
          onClick={onMedia}
          disabled={disabled}
        >
          Médias
        </button>
        <button
          aria-current={domain === "photo" ? "page" : undefined}
          onClick={onPhotos}
          disabled={disabled}
        >
          Photos
        </button>
        <button
          aria-current={domain === "video" ? "page" : undefined}
          onClick={onVideo}
          disabled={disabled}
        >
          Montage
        </button>
        <button onClick={onReview} disabled={disabled || !project}>
          Livraisons
        </button>
        <span className="workbench-local">
          <FolderOpen size={13} /> Travail local · originaux conservés
        </span>
      </nav>
    </header>
  );
}
