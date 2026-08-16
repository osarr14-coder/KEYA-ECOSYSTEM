/**
 * Ticket 012 : supprime toutes les bases IndexedDB existantes, en attendant
 * RÉELLEMENT la fin de chaque suppression — `indexedDB.deleteDatabase(name)`
 * renvoie une requête asynchrone (événements `onsuccess`/`onerror`), jamais
 * une Promise ; l'appeler sans écouter sa complétion (le motif utilisé
 * jusqu'ici dans ces fichiers de test) fonctionnait tant que rien ne
 * rouvrait la base dans le MÊME `beforeEach` juste après. Ticket 012 change
 * cela (`seedFixtureMissions()` rouvre immédiatement après le nettoyage) —
 * piège de course rencontré en écrivant ces tests : le nettoyage n'était
 * pas encore terminé quand le seed suivant commençait, laissant le cache
 * des missions vide de façon intermittente (flaky, pas systématique).
 */
export async function clearIndexedDB(): Promise<void> {
  const databases = await indexedDB.databases();
  await Promise.all(
    databases
      .filter((database): database is IDBDatabaseInfo & { name: string } => Boolean(database.name))
      .map((database) => new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(database.name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        // PAS de résolution anticipée sur `onblocked` : un composant démonté
        // entre deux tests peut laisser une lecture IndexedDB « en vol »
        // (ex : `MissionsListView`, qui ne bloque volontairement pas son
        // rendu sur la résolution complète de son effet — voir son propre
        // commentaire). Cette connexion finit TOUJOURS par se fermer (nos
        // fonctions de `repository.ts` ferment systématiquement dans un
        // `finally`), donc `onsuccess` finit par arriver — résoudre trop tôt
        // ici a fait disparaître silencieusement des données tout juste
        // réécrites par le test suivant (la suppression, réellement
        // terminée APRÈS coup, s'exécutait alors sur la base fraîchement
        // reseedée) : piège rencontré et reproduit en écrivant ces tests.
      })),
  );
}
