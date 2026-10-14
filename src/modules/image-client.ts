import formats from "../../electron/media-formats.json";
import { PhotoError, photoFailure } from "./image-errors";
export type Priority = "foreground" | "background" | "prefetch";
type Task = {
  id: number;
  data: any;
  priority: Priority;
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  signal?: AbortSignal;
  abort?: () => void;
};
type Lane = {
  worker?: Worker;
  active?: Task;
  timer?: ReturnType<typeof setTimeout>;
};
/**
 * How many photos a background pass may decode at once. Bounded on purpose:
 * each lane can hold a decoded image, so the pool trades memory for speed.
 */
export function laneCount(cores = navigator.hardwareConcurrency || 4) {
  return Math.max(1, Math.min(4, cores - 2));
}
/** One queue, one or more worker lanes. Ordering by priority is preserved. */
function createQueue(lanes = 1) {
  const pool: Lane[] = Array.from({ length: Math.max(1, lanes) }, () => ({}));
  let sequence = 0;
  const tasks: Task[] = [];
  const rank = { foreground: 0, background: 1, prefetch: 2 };
  function pump() {
    if (!tasks.length) return;
    const lane = pool.find((l) => !l.active);
    if (!lane) return;
    tasks.sort((a, b) => rank[a.priority] - rank[b.priority]);
    lane.active = tasks.shift();
    try {
      if (!lane.worker) {
        lane.worker = new Worker(
          new URL("./image-worker.ts", import.meta.url),
          {
            type: "module",
          },
        );
        lane.worker.onmessage = ({ data }) => {
          if (data.id !== lane.active?.id) return;
          clearTimeout(lane.timer);
          const task = lane.active!;
          lane.active = undefined;
          task.signal?.removeEventListener("abort", task.abort!);
          // An import must not keep full RAW buffers and nested WASM workers alive.
          if (
            data.error ||
            (task.data.kind === "inspect" &&
              formats.raw.includes(
                (task.data.name || "").split(".").pop()?.toLowerCase(),
              ))
          ) {
            lane.worker?.terminate();
            lane.worker = undefined;
          }
          data.error
            ? task.reject(
                new PhotoError(
                  typeof data.error === "string"
                    ? photoFailure(Error(data.error))
                    : data.error,
                ),
              )
            : task.resolve(data.result);
          pump();
        };
        lane.worker.onerror = () =>
          fail(
            lane,
            "Le moteur photo a rencontré une erreur. Vous pouvez relancer le traitement.",
          );
        lane.worker.onmessageerror = () =>
          fail(lane, "Le résultat du moteur photo n’a pas pu être lu.");
      }
      lane.timer = setTimeout(
        () => fail(lane, "Délai du moteur photo dépassé."),
        360000,
      );
      lane.worker.postMessage({
        ...lane.active!.data,
        id: lane.active!.id,
        base: document.baseURI,
      });
    } catch (error) {
      fail(lane, "Impossible de démarrer le moteur photo : " + String(error));
    }
    // A free lane may still be waiting for the next queued task.
    if (tasks.length && pool.some((l) => !l.active)) pump();
  }
  function fail(lane: Lane, message: string) {
    clearTimeout(lane.timer);
    lane.worker?.terminate();
    lane.worker = undefined;
    const task = lane.active;
    lane.active = undefined;
    task?.signal?.removeEventListener("abort", task.abort!);
    task?.reject(
      new PhotoError({
        code: /Délai/.test(message) ? "PHOTO_TIMEOUT" : "PHOTO_WORKER_CRASH",
        stage: task.data.kind,
        message,
        technical: message,
        retryable: true,
      }),
    );
    pump();
  }
  function request<T>(
    data: any,
    priority: Priority = "foreground",
    signal?: AbortSignal,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException("Aperçu annulé", "AbortError"));
        return;
      }
      if (priority === "prefetch") {
        const stale = tasks.filter((t) => t.priority === "prefetch");
        for (const t of stale) {
          tasks.splice(tasks.indexOf(t), 1);
          t.signal?.removeEventListener("abort", t.abort!);
          t.reject(Error("Préchargement remplacé."));
        }
      }
      const task: Task = {
        id: ++sequence,
        data,
        priority,
        resolve,
        reject,
        signal,
      };
      task.abort = () => {
        const index = tasks.indexOf(task);
        if (index >= 0) tasks.splice(index, 1);
        // An obsolete result can be ignored; terminating the worker here loses
        // its decoded RAW cache and restarts demosaicing on every slider movement.
        // Keep the active computation alive, with only the latest queued preview.
        reject(new DOMException("Aperçu annulé", "AbortError"));
        pump();
      };
      signal?.addEventListener("abort", task.abort, { once: true });
      tasks.push(task);
      pump();
    });
  }

  return request;
}
const previewQueue = createQueue();
// Imports and album passes are the only work worth spreading over the cores.
const backgroundQueue = createQueue(laneCount());
const thumbnailQueue = createQueue();
export function processImage<T>(
  data: any,
  priority: Priority = "foreground",
  signal?: AbortSignal,
): Promise<T> {
  const queue =
    data.kind === "thumbnail"
      ? thumbnailQueue
      : priority === "background"
        ? backgroundQueue
        : previewQueue;
  return queue<T>(data, priority, signal);
}
