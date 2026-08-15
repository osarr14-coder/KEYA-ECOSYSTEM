const MAX_DIMENSION_PX = 1600;
const JPEG_QUALITY = 0.7;

/**
 * Compression côté client AVANT mise en queue d'upload (ticket 010, passe
 * 2) — jamais côté serveur pour cette étape : le but est de réduire ce qui
 * doit transiter sur un réseau dégradé, pas seulement ce qui est stocké
 * (le serveur fait DÉJÀ sa propre compression/miniature après réception,
 * voir `apps.evidence.tasks.process_document_media`, ticket 004 — les deux
 * sont complémentaires, pas redondantes).
 *
 * Dégrade silencieusement vers le blob d'origine, jamais une exception, si
 * l'environnement ne fournit pas `createImageBitmap`/un contexte 2D exploi-
 * table (cas de jsdom en test, sans le paquet `canvas` — voir CLAUDE.md,
 * addendum passe 2) : la photo part alors non compressée plutôt que de
 * faire échouer toute la file média pour une raison purement d'environnement.
 */
export async function compressImage(blob: Blob): Promise<Blob> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    return blob;
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return blob;
  }

  try {
    const scale = Math.min(1, MAX_DIMENSION_PX / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return blob;

    context.drawImage(bitmap, 0, 0, width, height);

    const compressed = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY);
    });
    return compressed ?? blob;
  } finally {
    bitmap.close?.();
  }
}
