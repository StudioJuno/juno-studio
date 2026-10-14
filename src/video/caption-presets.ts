import type { CaptionStyle } from "./types";
import { titleSizeLimit } from "./transform";
export const CAPTION_PRESETS: {
  id: string;
  name: string;
  style: CaptionStyle;
}[] = [
  {
    id: "karaoke",
    name: "Social · karaoké",
    style: {
      wordMode: "highlight",
      highlightColor: "#ffe45c",
      fontFamily: "Inter",
      fontWeight: 700,
      color: "#ffffff",
      strokeColor: "#111111",
      strokeWidth: 4,
      backgroundOpacity: 0,
      y: 0.74,
      width: 0.8,
      uppercase: true,
      shadow: true,
    },
  },
  {
    id: "one-word",
    name: "Social · un mot à la fois",
    style: {
      wordMode: "single",
      fontFamily: "Inter",
      fontWeight: 700,
      color: "#ffffff",
      backgroundColor: "#7841ce",
      backgroundOpacity: 0.95,
      padding: 22,
      y: 0.74,
      width: 0.8,
      uppercase: true,
      shadow: false,
    },
  },
  {
    id: "classic",
    name: "Classique · lisible",
    style: {
      fontFamily: "Inter",
      fontWeight: 600,
      color: "#ffffff",
      strokeWidth: 0,
      backgroundColor: "#000000",
      backgroundOpacity: 0.68,
      y: 0.87,
      width: 0.86,
      uppercase: false,
      shadow: false,
    },
  },
  {
    id: "social",
    name: "Social · blanc contrasté",
    style: {
      fontFamily: "Inter",
      fontWeight: 700,
      color: "#ffffff",
      strokeColor: "#000000",
      strokeWidth: 5,
      backgroundOpacity: 0,
      y: 0.74,
      width: 0.8,
      uppercase: true,
      shadow: true,
    },
  },
  {
    id: "yellow",
    name: "Social · jaune",
    style: {
      fontFamily: "Inter",
      fontWeight: 700,
      color: "#ffe45c",
      strokeColor: "#111111",
      strokeWidth: 4,
      backgroundOpacity: 0,
      y: 0.74,
      width: 0.8,
      uppercase: true,
      shadow: true,
    },
  },
  {
    id: "pill",
    name: "Social · cartouche",
    style: {
      fontFamily: "Inter",
      fontWeight: 700,
      color: "#ffffff",
      strokeWidth: 0,
      backgroundColor: "#7841ce",
      backgroundOpacity: 1,
      padding: 22,
      y: 0.74,
      width: 0.76,
      uppercase: false,
      shadow: false,
    },
  },
  {
    id: "editorial",
    name: "Éditorial · sobre",
    style: {
      fontFamily: "Georgia",
      fontWeight: 400,
      italic: true,
      color: "#ffffff",
      strokeWidth: 0,
      backgroundOpacity: 0,
      y: 0.82,
      width: 0.85,
      uppercase: false,
      shadow: true,
    },
  },
  {
    id: "juno",
    name: "Juno · signature",
    style: {
      fontFamily: "Inter",
      fontWeight: 600,
      color: "#ffffff",
      strokeWidth: 0,
      backgroundColor: "#254d39",
      backgroundOpacity: 0.95,
      padding: 18,
      y: 0.78,
      width: 0.8,
      uppercase: false,
      shadow: false,
    },
  },
];
export function captionPreset(
  id: string,
  width: number,
  height = Math.round((width * 9) / 16),
): CaptionStyle {
  const preset = CAPTION_PRESETS.find((p) => p.id === id);
  if (!preset) throw Error("Modèle de sous-titres inconnu");
  return {
    effect:
      id === "social" || id === "yellow"
        ? "pop"
        : id === "pill"
          ? "rise"
          : "none",
    x: 0.5,
    align: "center",
    lineHeight: 1.15,
    rotation: 0,
    opacity: 1,
    italic: false,
    size: Math.max(
      12,
      Math.min(
        titleSizeLimit(height),
        Math.round(
          width * (id === "social" || id === "yellow" ? 0.047 : 0.034),
        ),
      ),
    ),
    ...preset.style,
  };
}
