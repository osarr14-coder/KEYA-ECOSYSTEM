import { useEffect, useRef, useState } from 'react';

import { AlertBanner } from '@keya/design-system';

import { SyncStatusIndicator } from '../components/SyncStatusIndicator';
import { CHECKLIST_TEMPLATE } from '../db/missions';
import {
  createEmptyDraft, deleteDraft, getCachedMission, getDraft, getDraftForMission, saveDraft,
} from '../db/repository';
import type { Decision, InspectionDraft, LocalPhoto, Mission } from '../db/types';

export interface InspectionFormViewProps {
  missionId: string;
  onBack: () => void;
}

function PhotoThumbnail({ photo, onRemove }: { photo: LocalPhoto; onRemove: () => void }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(photo.blob);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo.blob]);

  return (
    <li>
      {objectUrl && (
        <img src={objectUrl} alt={photo.fileName} width={72} height={72} style={{ objectFit: 'cover' }} />
      )}
      <span>{photo.fileName}</span>
      <button type="button" onClick={onRemove} aria-label={`Supprimer ${photo.fileName}`}>
        Supprimer
      </button>
    </li>
  );
}

/**
 * Saisie d'une inspection — TOUTE modification est écrite en IndexedDB
 * IMMÉDIATEMENT (voir `persist`), jamais différée jusqu'à un bouton
 * "Enregistrer" final : c'est ce qui garantit qu'aucune saisie n'est perdue
 * si l'inspecteur ferme l'application à tout moment, pas seulement s'il
 * pense à valider avant de quitter (critère d'acceptation central de cette
 * passe du ticket 010).
 */
export function InspectionFormView({ missionId, onBack }: InspectionFormViewProps) {
  const [mission, setMission] = useState<Mission | null>(null);
  const [draft, setDraft] = useState<InspectionDraft | null>(null);
  const [loading, setLoading] = useState(true);

  // Ticket 015 — cause du bug confirmée en le reproduisant AVANT ce
  // correctif (`InspectionFormView.test.tsx`) : DOUBLE, les deux se
  // combinant pour perdre une saisie.
  // 1) État React non atomique : deux gestionnaires presque simultanés (ex.
  //    upload photo pendant que l'inspecteur choisit sa décision)
  //    construisaient chacun leur propre "next" à partir du MÊME `draft`
  //    figé dans la fermeture de leur rendu, sans savoir que l'autre venait
  //    aussi de le modifier.
  // 2) Écritures IndexedDB non sérialisées : `saveDraft` remplace
  //    intégralement l'enregistrement (jamais une fusion), et rien ne
  //    garantissait qu'un `saveDraft` lancé plus TÔT ne se termine pas plus
  //    TARD qu'un autre — l'écriture la plus ancienne pouvait alors écraser
  //    silencieusement la plus récente.
  //
  // `draftRef` (toujours la dernière valeur RÉELLEMENT connue, mise à jour
  // de façon SYNCHRONE par `persist`, jamais via une fermeture de rendu)
  // résout (1). `persistChainRef` (chaque écriture IndexedDB n'est lancée
  // qu'une fois la précédente terminée) résout (2) : un `saveDraft` ne peut
  // plus jamais en écraser un autre plus récent, quel que soit l'ordre dans
  // lequel IndexedDB les termine en interne.
  const draftRef = useRef<InspectionDraft | null>(null);
  draftRef.current = draft;
  const persistChainRef = useRef<Promise<InspectionDraft> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      // Ticket 012 : la mission vient désormais du cache local
      // (`getCachedMission`), jamais de `MOCK_MISSIONS` (retiré) — chargée
      // en parallèle du brouillon, pas de dépendance entre les deux.
      const [existing, cachedMission] = await Promise.all([
        getDraftForMission(missionId),
        getCachedMission(missionId),
      ]);
      const initial = existing ?? createEmptyDraft(
        missionId, CHECKLIST_TEMPLATE, cachedMission?.reserveLatestEventId ?? null,
      );
      if (!cancelled) {
        setDraft(initial);
        draftRef.current = initial;
        setMission(cachedMission ?? null);
        setLoading(false);
        persistChainRef.current = Promise.resolve(initial);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [missionId]);

  function persist(mutate: (current: InspectionDraft) => InspectionDraft): Promise<InspectionDraft> | undefined {
    const current = draftRef.current;
    if (!current) return undefined;

    // Mise à jour optimiste SYNCHRONE — jamais différée derrière la file
    // d'écriture ci-dessous, sous peine de régresser le critère
    // d'acceptation central de la passe 1 (« chaque saisie est écrite
    // immédiatement, jamais différée jusqu'à... »), y compris à l'écran.
    const next = mutate(current);
    draftRef.current = next;
    setDraft(next);

    const queue = persistChainRef.current ?? Promise.resolve(next);
    const nextInChain = queue.then(async () => {
      // Ticket 016 ter (5e parcours) : `current` (et donc `next`, dérivé de
      // lui) peut être PÉRIMÉ par rapport à IndexedDB — le moteur de
      // synchro (`syncEngine.ts`) écrit directement dans IndexedDB via
      // `patchDraft` en arrière-plan (syncStatus, knownLatestEventId,
      // evidenceId, statut par photo...) SANS jamais repasser par cet état
      // React, qui ne se met à jour qu'à partir de SES PROPRES écritures
      // (voir `.then((saved) => ...)` ci-dessous). Sans cette relecture, la
      // moindre saisie suivante (ex. ajouter une photo APRÈS que
      // l'inspection a déjà été synchronisée) écraserait silencieusement
      // `syncStatus`/`knownLatestEventId` vers leur valeur d'avant synchro,
      // provoquant une resoumission inutile rejetée à tort en conflit (409)
      // par le serveur. Relit donc l'état RÉEL juste avant d'écrire et
      // réapplique la MÊME mutation dessus — chaque `mutate` ci-dessus
      // n'opère que sur son paramètre, jamais sur la fermeture, donc cette
      // réapplication est sûre. Même principe déjà appliqué côté moteur de
      // synchro lui-même (ticket 015 ter).
      const freshBase = (await getDraft(current.id)) ?? current;
      return saveDraft(mutate(freshBase));
    }).then((saved) => {
      // Une écriture plus RÉCENTE a pu être lancée entre-temps (donc
      // `draftRef.current` a déjà avancé au-delà de `next`) : le résultat
      // de CETTE écriture (horodatage device de SA propre saisie) serait
      // alors périmé — l'appliquer régresserait l'affichage et la donnée
      // en mémoire vers un état antérieur. On ignore silencieusement ce
      // résultat dans ce cas ; la donnée déjà écrite en IndexedDB reste
      // correcte car les écritures elles-mêmes restent, elles, strictement
      // sérialisées ci-dessus.
      if (draftRef.current === next) {
        draftRef.current = saved;
        setDraft(saved);
      }
      return saved;
    });
    persistChainRef.current = nextInChain;
    return nextInChain;
  }

  function toggleChecklistItem(itemId: string) {
    void persist((current) => ({
      ...current,
      checklist: current.checklist.map((item) => (
        item.id === itemId ? { ...item, checked: !item.checked } : item
      )),
    }));
  }

  function handleCommentBlur(event: React.FocusEvent<HTMLTextAreaElement>) {
    const { value } = event.target;
    void persist((current) => ({ ...current, comment: value }));
  }

  function handleDecisionChange(decision: Decision) {
    void persist((current) => ({ ...current, decision }));
  }

  async function handlePhotoAdd(event: React.ChangeEvent<HTMLInputElement>) {
    if (!event.target.files || event.target.files.length === 0) return;
    const files = Array.from(event.target.files);
    const newPhotos: LocalPhoto[] = files.map((file) => ({
      id: crypto.randomUUID(),
      blob: file,
      fileName: file.name,
      capturedAt: new Date().toISOString(),
      mediaSyncStatus: 'pending',
      remoteDocumentId: null,
      retryCount: 0,
      nextRetryAt: null,
    }));
    await persist((current) => ({ ...current, photos: [...current.photos, ...newPhotos] }));
    // Permet de recapturer/resélectionner le même fichier ensuite.
    event.target.value = '';
  }

  function handlePhotoRemove(photoId: string) {
    void persist((current) => ({
      ...current, photos: current.photos.filter((photo) => photo.id !== photoId),
    }));
  }

  /**
   * Seule action de résolution construite dans cette passe (ticket 010,
   * passe 2) : jamais de nouvelle tentative automatique sur un item en
   * conflit (voir syncEngine.ts) — l'inspecteur doit explicitement choisir
   * d'abandonner sa saisie devenue obsolète pour repartir d'un formulaire
   * vierge, en connaissance du dernier état serveur affiché ci-dessous.
   * Une résolution plus fine (fusion, "un rôle habilité" distinct de
   * l'inspecteur lui-même — voir le ticket) reste un point d'extension non
   * couvert ici.
   */
  async function resolveConflictByDiscarding() {
    if (!draft) return;
    await deleteDraft(draft.id);
    const fresh = createEmptyDraft(missionId, CHECKLIST_TEMPLATE);
    setDraft(fresh);
    // Repart d'une file neuve sur ce brouillon neuf — jamais chaînée sur la
    // file de l'ancien brouillon abandonné (voir `persist` ci-dessus).
    persistChainRef.current = Promise.resolve(fresh);
  }

  if (loading || !draft) {
    return <p>Chargement…</p>;
  }

  return (
    <section aria-label="Inspection">
      <button type="button" onClick={onBack}>← Missions</button>
      <h1>{mission ? `${mission.lotName} — ${mission.assetName}` : missionId}</h1>
      {mission && <p>{mission.programName} · {mission.milestoneLabel}</p>}

      <SyncStatusIndicator status={draft.syncStatus} />

      {draft.syncStatus === 'conflict' && (
        <AlertBanner title="Conflit à résoudre">
          Cette inspection a déjà été modifiée par ailleurs depuis votre dernière saisie
          {draft.conflict?.currentEventSource ? ` (dernier événement serveur : ${draft.conflict.currentEventSource})` : ''}.
          Votre saisie n'a PAS été envoyée pour éviter d'écraser cette modification.
          <div>
            <button type="button" onClick={() => void resolveConflictByDiscarding()}>
              Ignorer ma saisie et recommencer
            </button>
          </div>
        </AlertBanner>
      )}

      <fieldset>
        <legend>Checklist</legend>
        {draft.checklist.map((item) => (
          <label key={item.id} style={{ display: 'block', padding: '8px 0', minHeight: '44px' }}>
            <input
              type="checkbox"
              checked={item.checked}
              onChange={() => toggleChecklistItem(item.id)}
            />
            {item.label}
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>Photos</legend>
        <label>
          Ajouter une photo
          <input
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            aria-label="Ajouter une photo"
            onChange={handlePhotoAdd}
          />
        </label>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {draft.photos.map((photo) => (
            <PhotoThumbnail key={photo.id} photo={photo} onRemove={() => handlePhotoRemove(photo.id)} />
          ))}
        </ul>
      </fieldset>

      <label>
        Commentaire
        {/* `key={draft.id}` : force un vrai remount quand le brouillon
            change d'identité (ex : abandon d'un conflit puis reprise sur un
            brouillon neuf, voir `resolveConflictByDiscarding` ci-dessus) —
            sans quoi `defaultValue` (non contrôlé, volontaire : voir
            docstring plus haut) resterait figé sur l'ancien commentaire,
            React ne réappliquant jamais `defaultValue` sur un composant déjà
            monté. */}
        <textarea key={draft.id} defaultValue={draft.comment} onBlur={handleCommentBlur} />
      </label>

      <fieldset>
        <legend>Décision</legend>
        <label style={{ minHeight: '44px', display: 'inline-block' }}>
          <input
            type="radio" name="decision" value="conforme"
            checked={draft.decision === 'conforme'}
            onChange={() => handleDecisionChange('conforme')}
          />
          Conforme
        </label>
        <label style={{ minHeight: '44px', display: 'inline-block' }}>
          <input
            type="radio" name="decision" value="reserve"
            checked={draft.decision === 'reserve'}
            onChange={() => handleDecisionChange('reserve')}
          />
          Réserve
        </label>
      </fieldset>
    </section>
  );
}
