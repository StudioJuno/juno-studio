/**
 * Face descriptors, computed locally. The network is the ResNet of face-api,
 * loaded from the files bundled with the application: nothing is fetched from
 * the network, and no image ever leaves this machine.
 */
import * as faceapi from "@vladmandic/face-api";
let ready: Promise<void> | undefined;
async function load(base: string) {
  ready ??= (async () => {
    // face-api probes for a browser or for Node. A Web Worker is neither, so
    // it must be handed the primitives it needs: OffscreenCanvas and fetch.
    const env = faceapi.env as unknown as {
      setEnv(value: Record<string, unknown>): void;
    };
    env.setEnv({
      Canvas: OffscreenCanvas,
      CanvasRenderingContext2D:
        (
          globalThis as unknown as {
            OffscreenCanvasRenderingContext2D: unknown;
          }
        ).OffscreenCanvasRenderingContext2D ?? class {},
      Image: ImageBitmap,
      ImageData,
      Video: class {},
      createCanvasElement: () => new OffscreenCanvas(1, 1),
      createImageElement: () => {
        throw Error("Image non disponible dans ce contexte");
      },
      createVideoElement: () => {
        throw Error("Vidéo non disponible dans ce contexte");
      },
      fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
      readFile: () => {
        throw Error("Lecture de fichier non disponible dans ce contexte");
      },
    });
    // The typings do not expose the runtime helpers of the bundled tfjs.
    const tf = faceapi.tf as unknown as {
      setBackend(name: string): Promise<boolean>;
      ready(): Promise<void>;
    };
    // Measured on real faces: 127 ms each on the GPU against 358 on the CPU.
    try {
      if (!(await tf.setBackend("webgl"))) throw Error("webgl refusé");
      await tf.ready();
    } catch {
      await tf.setBackend("cpu");
      await tf.ready();
    }
    await faceapi.nets.faceRecognitionNet.loadFromUri(base + "models/face-api");
  })();
  return ready;
}
type Request = {
  id: number;
  base: string;
  /** One crop per face, already cut out of the photo by the caller. */
  crops: ImageBitmap[];
};
self.onmessage = async ({ data }: MessageEvent<Request>) => {
  const { id, base, crops } = data;
  try {
    await load(base);
    const descriptors: (number[] | undefined)[] = [];
    // Keep the first real cause: a silent failure per crop hides the reason
    // why recognition is degraded for a whole album.
    let warning = "";
    for (const crop of crops) {
      try {
        const canvas = new OffscreenCanvas(crop.width, crop.height);
        canvas.getContext("2d")!.drawImage(crop, 0, 0);
        const tensor = faceapi.tf.browser.fromPixels(
          canvas as unknown as HTMLCanvasElement,
        );
        try {
          const value = await faceapi.computeFaceDescriptor(
            tensor as unknown as faceapi.TNetInput,
          );
          descriptors.push(Array.from(value as Float32Array));
        } finally {
          tensor.dispose();
        }
      } catch (e) {
        // One unreadable crop must not lose the whole photo's faces.
        warning ||= (e as Error).message || String(e);
        descriptors.push(undefined);
      } finally {
        crop.close();
      }
    }
    self.postMessage({ id, descriptors, warning });
  } catch (e) {
    for (const crop of crops)
      try {
        crop.close();
      } catch {
        /* already closed */
      }
    self.postMessage({
      id,
      error: (e as Error).message || "Empreinte faciale indisponible.",
    });
  }
};
