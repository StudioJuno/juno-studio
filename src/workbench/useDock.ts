import { useEffect } from "react";
export function useDock(name: string, open: boolean, close: () => void) {
  useEffect(() => {
    const other = (e: Event) => {
      if ((e as CustomEvent).detail !== name) close();
    };
    window.addEventListener("juno-dock-open", other);
    return () => window.removeEventListener("juno-dock-open", other);
  }, [name, close]);
  useEffect(() => {
    if (!open) return;
    document.body.dataset.dock = name;
    const header = document.querySelector(".workbench-header");
    const measure = () =>
      document.documentElement.style.setProperty(
        "--dock-top",
        Math.ceil(header?.getBoundingClientRect().bottom || 102) + "px",
      );
    measure();
    const resize = new ResizeObserver(measure);
    if (header) resize.observe(header);
    window.dispatchEvent(new CustomEvent("juno-dock-open", { detail: name }));
    return () => {
      resize.disconnect();
      if (document.body.dataset.dock === name)
        delete document.body.dataset.dock;
    };
  }, [name, open]);
}
