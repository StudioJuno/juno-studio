import {
  cachedEditedThumbnail,
  renderEditedThumbnail,
} from "./edited-thumbnail";
import { useEffect, useState } from "react";
import { getThumbnail } from "../db";
import type { Photo } from "../model";
const cache = new Map<string, string>(),
  pending = new Map<string, Promise<string>>();
function thumbnail(id: string) {
  if (cache.has(id)) {
    const value = cache.get(id)!;
    cache.delete(id);
    cache.set(id, value);
    return Promise.resolve(value);
  }
  if (pending.has(id)) return pending.get(id)!;
  const request = getThumbnail(id)
    .then((value) => {
      cache.set(id, value);
      while (cache.size > 220) cache.delete(cache.keys().next().value!);
      return value;
    })
    .finally(() => pending.delete(id));
  pending.set(id, request);
  return request;
}
export function useThumbnail(photo: Photo) {
  const [value, setValue] = useState(
    photo.thumbnail || cache.get(photo.id) || "",
  );
  useEffect(() => {
    let active = true;
    setValue(photo.thumbnail || cache.get(photo.id) || "");
    if (!photo.thumbnail)
      void thumbnail(photo.id)
        .then((v) => {
          if (active) setValue(v);
        })
        .catch(() => {
          if (active) setValue("");
        });
    return () => {
      active = false;
    };
  }, [photo.id, photo.thumbnail]);
  return value;
}
export default function PhotoThumbnail({
  photo,
  ...props
}: { photo: Photo } & Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src">) {
  const original = useThumbnail(photo);
  const [edited, setEdited] = useState(cachedEditedThumbnail(photo) || "");
  const key = JSON.stringify(photo.adjustments);
  useEffect(() => {
    const controller = new AbortController();
    const cached = cachedEditedThumbnail(photo);
    setEdited(cached || "");
    if (
      !cached &&
      !photo.previewOnly &&
      (photo.history.length || photo.adjustments.style !== "original")
    ) {
      void renderEditedThumbnail(
        photo,
        photo.adjustments,
        controller.signal,
        "background",
      )
        .then(() => {
          if (!controller.signal.aborted)
            setEdited(cachedEditedThumbnail(photo) || "");
        })
        .catch(() => {});
    }
    return () => controller.abort();
  }, [photo.id, photo.hash, photo.source, key, photo.previewOnly]);
  const src = edited || original;
  return src ? (
    <img {...props} src={src} />
  ) : (
    <span
      className="thumbnail-placeholder"
      aria-label="Chargement de l’aperçu"
    />
  );
}
