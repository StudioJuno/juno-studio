import { it, expect, vi, afterEach } from "vitest";
class WorkerMock {
  static all: WorkerMock[] = [];
  onmessage: any;
  onerror: any;
  onmessageerror: any;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    WorkerMock.all.push(this);
  }
  finish(result: any) {
    this.onmessage({
      data: { id: this.postMessage.mock.calls.at(-1)?.[0].id, result },
    });
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  WorkerMock.all = [];
});
it("cancels 100 stale previews without interrupting an import or building a backlog", async () => {
  vi.stubGlobal("Worker", WorkerMock);
  vi.stubGlobal("document", { baseURI: "file:///test/" });
  const { processImage } = await import("../src/modules/image-client");
  const ongoing = processImage(
    { kind: "inspect", name: "photo.jpg" },
    "background",
  );
  const worker = WorkerMock.all[0];
  const cancelled = [];
  for (let i = 0; i < 100; i++) {
    const controller = new AbortController();
    cancelled.push(
      processImage({ kind: "render" }, "foreground", controller.signal).catch(
        (e) => e.name,
      ),
    );
    controller.abort();
  }
  const last = processImage({ kind: "render", marker: "latest" });
  // Foreground previews no longer wait for background imports.
  expect(WorkerMock.all).toHaveLength(2);
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
  const previewWorker = WorkerMock.all[1];
  expect(previewWorker.terminate).not.toHaveBeenCalled();
  previewWorker.finish("obsolete");
  expect(previewWorker.postMessage.mock.calls.at(-1)![0].marker).toBe("latest");
  previewWorker.finish("rendered");
  expect(await last).toBe("rendered");
  worker.finish("imported");
  expect(await ongoing).toBe("imported");
  expect((await Promise.all(cancelled)).every((x) => x === "AbortError")).toBe(
    true,
  );
});
it("recovers from worker startup and message transfer failures", async () => {
  vi.stubGlobal("document", { baseURI: "file:///test/" });
  vi.stubGlobal(
    "Worker",
    class {
      constructor() {
        throw Error("startup failure");
      }
    },
  );
  const { processImage } = await import("../src/modules/image-client");
  await expect(processImage({ kind: "render" })).rejects.toThrow(
    "startup failure",
  );
  vi.stubGlobal("Worker", WorkerMock);
  const failed = processImage({ kind: "render" }).catch((e) => e);
  WorkerMock.all[0].onmessageerror();
  expect((await failed).detail.code).toBe("PHOTO_WORKER_CRASH");
  const next = processImage({ kind: "render" });
  WorkerMock.all.at(-1)!.finish("ok");
  expect(await next).toBe("ok");
});
