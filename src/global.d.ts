type LookFolder = {
  dossier: string;
  nom: string;
  trouves: number;
  illisibles: number;
  /** Chaque photo livrée, décodée en 160 px de large, en BGRA. */
  images: { width: number; height: number; bgra: Uint8Array }[];
};
type StyleFolder = {
  dossier: string;
  nom: string;
  trouves: number;
  illisibles: number;
  /** Les attributs crs: de chaque fichier, pas le fichier entier. */
  fichiers: string[];
};
import type { Photo, Project } from "./model";
import type {
  VideoProject,
  MulticamGroup,
  Sequence,
  VideoJob,
  EngineStatus,
} from "./video/types";
export type TeamSession = {
  url: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: "admin" | "photographer" | "reviewer";
  };
  expires: number;
};
export type TeamRequest = {
  route: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  revision?: number;
};
declare global {
  /** Version de package.json, injectée par vite.config.ts (absente sous vitest). */
  const __JUNO_VERSION__: string | undefined;
  type PlannerStatus = {
    available: boolean;
    running: boolean;
    local: boolean;
    model: string;
    /** Où est le modèle : téléchargé (retirable) ou embarqué, ou nulle part. */
    source: "telecharge" | "embarque" | null;
    taille: number;
    installable: boolean;
    installation: {
      fait: number;
      total: number;
      erreur?: string;
      enCours: boolean;
    } | null;
  };

  interface Window {
    juno?: {
      updates?: import('./modules/update-types').UpdateAPI;
      windowFullscreen?: (value: boolean) => Promise<boolean>;
      onWindowFullscreen?: (callback: (value: boolean) => void) => () => void;
      review: import("./review/types").ReviewAPI;
      planner: {
        status: () => Promise<PlannerStatus>;
        install: () => Promise<PlannerStatus>;
        cancelInstall: () => Promise<PlannerStatus>;
        uninstall: () => Promise<PlannerStatus>;
        plan: (input: {
          domain: "photo" | "video";
          text: string;
          scope: string;
        }) => Promise<{
          commands: string[];
          explanation: string;
          question: string;
          model: string;
          local: boolean;
          elapsedMs: number;
        }>;
        cancel: () => Promise<boolean>;
      };
      voice: {
        status: () => Promise<{
          available: boolean;
          local: boolean;
          maxSeconds: number;
          error: string;
        }>;
        transcribe: (input: {
          bytes: ArrayBuffer;
        }) => Promise<{ text: string; local: boolean; model: string }>;
        cancel: () => Promise<boolean>;
      };
      systemStatus: () => Promise<{
        version: string;
        platform: string;
        arch: string;
        system: string;
        memoryTotal: number;
        memoryFree: number;
        appMemory: number;
        diskFree: number;
        originalsRegistered: number;
        registryError: string;
      }>;
      registerDroppedMedia: (files: File[]) => Promise<
        {
          id: string;
          name: string;
          source: string;
          size: number;
          kind: string;
        }[]
      >;
      photoRaster: (id: string) => Promise<Uint8Array>;

      importSourceInfo: (id: string) => Promise<{
        path: string;
        exists: boolean;
        size?: number;
        managed: boolean;
      }>;
      secureImportSource: (input: {
        id: string;
        hash?: string;
      }) => Promise<{ hash: string; size: number; managed: boolean }>;
      locateImportSource: (input: {
        id: string;
        name: string;
        size: number;
        hash?: string;
      }) => Promise<boolean>;
      revealImportSource: (id: string) => Promise<boolean>;
      lightroom: import("./modules/lightroom").LightroomAPI;
      video: {
        commandHistory: (input: {
          projectId: string;
          sequenceId?: string;
        }) => Promise<import("./assistant/records").CommandRecord[]>;
        restoreCommand: (input: {
          projectId: string;
          id: string;
          redo?: boolean;
        }) => Promise<{ sequence: Sequence; revision: number }>;
        importRegistered: (input: {
          ids: string[];
          photoProjectId?: string;
          projectId?: string;
          name?: string;
        }) => Promise<{ projectId: string; job: VideoJob }>;
        locateImport: (input: {
          id: string;
          index: number;
        }) => Promise<VideoJob | null>;
        retryImport: (id: string) => Promise<VideoJob>;
        importReport: (id: string) => Promise<boolean>;

        revealJob: (id: string) => Promise<void>;
        autoColor: (input: {
          projectId: string;
          sequence: Sequence;
          referenceAssetId?: string;
          strength?: number;
        }) => Promise<VideoJob>;
        generationKeyStatus: () => Promise<boolean>;
        saveGenerationKey: (key: string) => Promise<boolean>;
        generate: (input: {
          projectId: string;
          prompt: string;
          model: string;
          aspect: string;
          resolution: string;
        }) => Promise<VideoJob>;
        importLut: () => Promise<{
          id: string;
          name: string;
          size: number;
        } | null>;
        readLut: (id: string) => Promise<{
          size: number;
          min: number[];
          max: number[];
          values: number[];
        }>;
        restore: () => Promise<VideoProject | null>;
        relink: (input: {
          projectId: string;
          assetId: string;
        }) => Promise<VideoJob | null>;
        history: (input: {
          projectId: string;
          revision?: number;
          sequenceId?: string;
        }) => Promise<{
          items?: {
            revision: number;
            updated: number;
            sequences: { id: string; name: string }[];
          }[];
          sequence?: Sequence;
        }>;
        multicam: (input: {
          projectId: string;
          action: "save" | "timecode" | "audio" | "build";
          group: MulticamGroup;
          settings?: { fps: Sequence["fps"]; width: number; height: number };
        }) => Promise<{
          group?: MulticamGroup;
          sequence?: Sequence;
          job?: VideoJob;
        }>;
        status: () => Promise<EngineStatus>;
        list: () => Promise<{
          projects: {
            id: string;
            name: string;
            photoProjectId: string | null;
            updated: number;
            revision?: number;
            count: number;
          }[];
          jobs: VideoJob[];
        }>;
        project: (id: string) => Promise<VideoProject>;
        create: (input: {
          name: string;
          photoProjectId?: string;
        }) => Promise<VideoProject>;
        saveSequence: (input: {
          projectId: string;
          sequence: Sequence;
          expectedVersion: number;
          command?: { id: string; label: string; source: string };
        }) => Promise<{ version: number; revision: number }>;
        import: (projectId: string) => Promise<VideoJob | null>;
        space: (input: {
          projectId: string;
          assetId: string;
          inputSpace: string;
        }) => Promise<VideoJob>;
        job: (input: {
          id: string;
          action: "pause" | "resume" | "cancel" | "remove";
        }) => Promise<void>;
        processAudio: (input: {
          projectId: string;
          assetId: string;
          settings: Record<string, number>;
        }) => Promise<VideoJob>;
        analyze: (input: {
          projectId: string;
          ids?: string[];
        }) => Promise<VideoJob>;
        derush: (input: {
          projectId: string;
          ids?: string[];
        }) => Promise<VideoJob>;
        derushDecision: (input: {
          projectId: string;
          assetId: string;
          debut: number;
          fin: number;
          etat: "bon" | "masque" | null;
        }) => Promise<import("./video/types").Asset>;
        derushPlans: (input: {
          projectId: string;
          plans: Record<string, "gros" | "moyen" | "large" | "sans-visage">;
        }) => Promise<void>;
        transcribe: (input: {
          projectId: string;
          ids?: string[];
          language?: string;
        }) => Promise<VideoJob>;
        transcript: (input: {
          projectId: string;
          assetId: string;
          segments: import("./video/types").TranscriptSegment[];
        }) => Promise<void>;
        overlay: (input: {
          projectId: string;
          bytes: ArrayBuffer;
        }) => Promise<string>;
        export: (input: {
          review?: boolean;
          projectId: string;
          sequence: Sequence;
          codec: string;
          overlays: {
            id: string;
            start: number;
            duration: number;
            motionOrigin?: number;
            placement?: {
              x: number;
              y: number;
              width: number;
              height: number;
              motion: import("./video/motion").Motion;
            };
          }[];
          maskImages?: Record<string, string>;
          /** Cible de niveau sonore, ou null pour livrer le montage tel quel. */
          loudness?: string | null;
        }) => Promise<VideoJob | null>;
        trackMask: (input: {
          projectId: string;
          clipId: string;
          maskId: string;
          sequence: Sequence;
        }) => Promise<VideoJob>;
        backup: (projectId: string) => Promise<boolean>;
        comment: (input: {
          projectId: string;
          sequenceId: string;
          frame: number;
          text: string;
        }) => Promise<VideoProject["comments"]>;
      };

      pickImages: () => Promise<
        {
          id: string;
          name: string;
          source: string;
          size: number;
          kind?: string;
        }[]
      >;
      saveFile: (name: string, data: ArrayBuffer) => Promise<boolean>;
      beginExport: () => Promise<string | null>;
      writeExport: (
        token: string,
        name: string,
        data: ArrayBuffer,
      ) => Promise<void>;
      finishExport: (token: string) => Promise<void>;
      keyStatus: () => Promise<boolean>;
      saveKey: (key: string) => Promise<void>;
      imageBudget: (
        projectId: string,
      ) => Promise<{
        limitEuro: number;
        reservedEuro: number;
        remainingEuro: number;
        nextReservationEuro: number;
        canRun: boolean;
      }>;
      editAI: (request: {
        projectId: string;
        prompt: string;
        image?: ArrayBuffer;
        mask?: ArrayBuffer;
        reference?: ArrayBuffer;
        mode: "edit" | "generate";
      }) => Promise<{ bytes: Uint8Array; model: string }>;
      copyOriginal: (
        token: string,
        name: string,
        source: string,
        bytes?: ArrayBuffer,
      ) => Promise<{ sha256: string; size: number }>;
      /** Lit les .xmp d'un dossier Lightroom, en lecture seule. */
      stylePickFolder: () => Promise<StyleFolder | null>;
      styleReadFolder: (folder: string) => Promise<StyleFolder>;
      /** Mesure le rendu d'un dossier de photos livrées, en lecture seule. */
      lookPickFolder: () => Promise<LookFolder | null>;
      lookReadFolder: (folder: string) => Promise<LookFolder>;
      restoreBackup: () => Promise<{
        project: Project;
        photos: Photo[];
      } | null>;
      relinkOriginals: (
        records: { id: string; hash: string }[],
      ) => Promise<{ id: string; source: string }[]>;
      teamLocalStatus: () => Promise<{
        installed: boolean;
        available: boolean;
        setupRequired: boolean;
        url: string;
      }>;
      teamLocalSetup: (input: {
        email: string;
        password: string;
      }) => Promise<TeamSession>;
      teamStatus: () => Promise<TeamSession | null>;
      teamLogin: (input: {
        url: string;
        email: string;
        password: string;
      }) => Promise<TeamSession>;
      teamLogout: () => Promise<void>;
      teamRequest: <T = unknown>(input: TeamRequest) => Promise<T>;
    };
  }
}
