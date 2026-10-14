export const shareId =
  location.pathname.match(/^\/r\/([A-Za-z0-9_-]+)$/)?.[1] || "";
export class APIError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method = "GET",
  value?: unknown,
): Promise<T> {
  const r = await fetch("/api/client/" + shareId + "/" + path, {
    method,
    credentials: "same-origin",
    headers: {
      "X-Juno-Client": "1",
      ...(value == null ? {} : { "Content-Type": "application/json" }),
    },
    body: value == null ? undefined : JSON.stringify(value),
    signal: AbortSignal.timeout(30000),
  });
  const data = await r.json();
  if (!r.ok)
    throw new APIError(data.error || "Impossible de joindre Juno.", r.status);
  return data;
}
export const mediaURL = (
  assetId: string,
  thumbnail = false,
  download = false,
) =>
  "/api/client/" +
  shareId +
  "/assets/" +
  assetId +
  "/" +
  (thumbnail ? "thumbnail" : "file") +
  (download ? "?download=1" : "");
export const date = (ms: number) =>
  new Date(ms).toLocaleString("fr-FR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
export function time(frame: number, fps = { n: 25, d: 1 }) {
  const seconds = (frame * fps.d) / fps.n;
  return (
    Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0") +
    ":" +
    (seconds % 60).toFixed(2).padStart(5, "0")
  );
}
