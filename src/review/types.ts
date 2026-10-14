import type { Photo } from "../model";
export type ReviewStatus = {
  available: boolean;
  url: string;
  mode: "local" | "remote";
  error?: string;
  operator?: { id: string; name: string; role: string };
  storageBytes?: number;
  maxStorageBytes?: number;
};
export type ReviewJob = {
  id: string;
  state: string;
  title: string;
  projectId: string;
  kind: "photo" | "video";
  total: number;
  prepared: number;
  uploaded: number;
  errors: { logical_id: string; error: string }[];
  deliveryId?: string;
  revisionId?: string;
  created: number;
  error: string;
  hidden: boolean;
  url: string;
  origin: string;
};
export type ReviewAsset = {
  id: string;
  revision_id: string;
  logical_id: string;
  kind: "photo" | "video";
  name: string;
  state: string;
  position: number;
  metadata: {
    width: number;
    height: number;
    sourceId: string;
    projectId: string;
    fps?: { n: number; d: number };
    frames?: number;
    snapshot?: {
      adjustments?: Photo["adjustments"];
      revision?: number;
      sequence?: { id: string; version?: number };
    };
  };
};
export type ReviewThread = {
  id: string;
  revision_id: string;
  asset_id: string | null;
  visibility: "external" | "internal";
  status: string;
  revision: number;
  assigned_to?: string;
  anchor: {
    frame?: number;
    endFrame?: number;
    point?: { x: number; y: number };
  };
  comments: {
    id: string;
    author: string;
    body: string;
    internal: boolean;
    created: number;
  }[];
};
export type ReviewDelivery = {
  id: string;
  project_id: string;
  title: string;
  message: string;
  active_revision: string | null;
  version?: number;
  archived: boolean;
  created: number;
  openCount?: number;
  decision: { state: string; required: number; approved: number };
  revisions?: {
    id: string;
    number: number;
    state: string;
    expected_count: number;
    ready_count: number;
  }[];
  shares?: {
    id: string;
    name: string;
    expires: number | null;
    revoked: boolean;
    downloads: boolean;
    protected: boolean;
    required: boolean;
    can_approve: boolean;
  }[];
};
export type ReviewBegin = {
  projectId: string;
  projectName: string;
  title: string;
  message: string;
  kind: "photo" | "video";
  photos?: Photo[];
  targetDeliveryId?: string;
  code: string;
  downloads: boolean;
  expires: number | null;
  clientName: string;
  videoProjectId?: string;
  videoJobId?: string;
};
export type ReviewAPI = {
  status: () => Promise<ReviewStatus>;
  connect: (input: {
    local?: boolean;
    url?: string;
    token?: string;
  }) => Promise<ReviewStatus>;
  request: <T>(input: {
    route: string;
    method?: string;
    body?: unknown;
  }) => Promise<{ data: T; cached: boolean; updated?: number }>;
  link: (input: { shareId: string; open?: boolean }) => Promise<string>;
  createShare: (input: {
    deliveryId: string;
    options: {
      name: string;
      code?: string;
      downloads?: boolean;
      expires?: number | null;
      canApprove?: boolean;
      required?: boolean;
    };
  }) => Promise<{ id: string; url: string }>;
  jobs: () => Promise<ReviewJob[]>;
  begin: (input: ReviewBegin) => Promise<ReviewJob>;
  preparation: (input: { id: string }) => Promise<{
    job: ReviewJob;
    photos: (Photo & { preparationError?: string })[];
  }>;
  stagePhoto: (input: {
    jobId: string;
    photoId: string;
    bytes: ArrayBuffer;
    thumbnail: ArrayBuffer;
    width: number;
    height: number;
  }) => Promise<boolean>;
  preparationError: (input: {
    jobId: string;
    photoId: string;
    error: string;
  }) => Promise<boolean>;
  excludeFailed: (input: { id: string }) => Promise<ReviewJob>;
  stageVideo: (input: { id: string }) => Promise<boolean>;
  start: (input: { id: string }) => Promise<ReviewJob>;
  job: (input: {
    id: string;
    action: "pause" | "resume" | "cancel" | "hide";
  }) => Promise<ReviewJob>;
};
