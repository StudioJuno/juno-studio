export type PhotoFailure = {
  code: string;
  stage: string;
  message: string;
  technical: string;
  retryable: boolean;
  elapsedMs?: number;
};
export class PhotoError extends Error {
  constructor(public detail: PhotoFailure) { super(detail.message); this.name = "PhotoError"; }
}
export function photoFailure(error: unknown, stage = "import"): PhotoFailure {
  if (error instanceof PhotoError) return error.detail;
  const detail = (error as any)?.detail;
  if (detail?.code && detail?.message) return detail;
  const technical = String((error as any)?.message || error).slice(0, 2000);
  if (/LibRaw disposed|RAW_TIMEOUT|délai.*dépassé/i.test(technical)) return {code:"RAW_TIMEOUT",stage,message:"Le décodage RAW a dépassé le délai autorisé. Le fichier n’a pas été déclaré corrompu.",technical,retryable:true};
  if (/mémoire|out of memory|memory access|allocation|malloc/i.test(technical)) return {code:"MEMORY",stage,message:"Le moteur photo a manqué de mémoire. Une reprise avec un moteur réinitialisé est possible.",technical,retryable:true};
  if (/ENOSPC|quota|espace.*insuffisant/i.test(technical)) return {code:"DISK_SPACE",stage,message:"Espace de stockage insuffisant. Libérez de la place puis reprenez l’importation.",technical,retryable:false};
  if (/ENOENT|Original indisponible|introuvable|Failed to fetch|source.*absent/i.test(technical)) return {code:"SOURCE_MISSING",stage,message:"Le fichier source est inaccessible. Reconnectez le disque ou retrouvez l’original.",technical,retryable:false};
  if (/EACCES|EPERM|permission|not allowed/i.test(technical)) return {code:"SOURCE_ACCESS",stage,message:"L’accès au fichier a été refusé. Vérifiez les autorisations du dossier.",technical,retryable:false};
  return {code:"DECODE_FAILED",stage,message:technical,technical,retryable:false};
}
