/**
 * Ouvrir une vignette de photo, quelle que soit sa forme.
 *
 * Les vignettes sont rangées en URL « data: » dans le catalogue. La politique
 * de sécurité de l'application interdit à `fetch` de les charger : il faut
 * décoder le base64 à la main. Le symptôme, quand on l'oublie, est un
 * « Fetch API cannot load data:image/jpeg » qui n'a rien d'évident.
 */
export function thumbnailBlob(thumbnail: string): Blob | undefined {
  if (!thumbnail?.startsWith("data:image/")) return undefined;
  const virgule = thumbnail.indexOf(",");
  const pointVirgule = thumbnail.indexOf(";");
  if (virgule < 0 || pointVirgule < 0) return undefined;
  return new Blob(
    [Uint8Array.from(atob(thumbnail.slice(virgule + 1)), (c) => c.charCodeAt(0))],
    { type: thumbnail.slice(5, pointVirgule) },
  );
}
export async function thumbnailBitmap(thumbnail: string) {
  const blob = thumbnailBlob(thumbnail) ?? (await (await fetch(thumbnail)).blob());
  return createImageBitmap(blob);
}
