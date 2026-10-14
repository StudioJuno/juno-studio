export type Asset = {
  id: string;
  logicalId: string;
  revisionId: string;
  kind: "photo" | "video";
  name: string;
  width: number;
  height: number;
  frames?: number;
  fps?: { n: number; d: number };
  duration?: number;
  thumbnail: boolean;
  position: number;
  size: number;
};
export type Anchor = {
  point?: { x: number; y: number; w?: number; h?: number };
  frame?: number;
  endFrame?: number;
  pts?: number;
};
export type Draft = {
  id: string;
  assetId?: string;
  name: string;
  body: string;
  anchor: Anchor;
};
export type Thread = {
  id: string;
  asset_id: string | null;
  revision_id: string;
  anchor: Anchor;
  status: string;
  created: number;
  revision: number;
  comments: { id: string; author: string; body: string; created: number }[];
};
export type Manifest = {
  delivery: { id: string; title: string; message: string };
  revision: { id: string; number: number; count: number };
  currentRevision: string;
  versions: { id: string; number: number; published: number }[];
  viewer: { id: string; name: string; verified: boolean };
  downloads: boolean;
  canApprove: boolean;
  selection: string[];
  selectionRevision: number;
  decision: { state: string; approved: number; required: number };
  ownDecision: { state: string; author: string; created: number } | null;
};
export type Submission = {
  opId: string;
  revisionId: string;
  comments: { assetId?: string; body: string; anchor: Anchor }[];
  selection: string[];
  selectionRevision: number;
};
