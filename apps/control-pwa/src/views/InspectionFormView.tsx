import { useEffect, useRef, useState } from 'react';

import {
  AlertBanner, Button, Input, semanticColors,
} from '@keya/design-system';

import { PhotoSyncStatusIndicator } from '../components/PhotoSyncStatusIndicator';
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

// Ticket 023 (polish visuel) — un seul style de fieldset partagé par les 3
// sections du formulaire (checklist/photos/décision), jamais redéfini
// séparément à chaque fois. Ticket 024 (audit accessibilité) : reprend le
// token partagé plutôt qu'une couleur redéfinie ici en dur.
const FIELDSET_STYLE = { border: `1px solid ${semanticColors.neutral.border}`, borderRadius: '8px', padding: '12px' };

function PhotoThumbnail({ photo, onRemove }: { photo: LocalPhoto; onRemove: () => void }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(photo.blob);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo.blob]);

  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      {objectUrl && (
        <img src={objectUrl} alt={photo.fileName} width={72} height={72} style={{ objectFit: 'cover' }} />
      )}
      <span style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <span>{photo.fileName}</span>
        <PhotoSyncStatusIndicator status={photo.mediaSyncStatus} />
      </span>
      {/* Ticket 024 (audit accessibilité) — cible tactile portée à 44x44
          (WCAG 2.5.5), app CONTROL PWA explicitement tactile (360-430px,
          voir CLAUDE.md). Aucun bouton natif de ce fichier n'avait de taille
          minimale garantie avant ce ticket. */}
      <Button
        type="button"
        variant="secondary"
        onClick={onRemove}
        aria-label={`Supprimer ${photo.fileName}`}
        style={{ minWidth: '44px', minHeight: '44px' }}
      >
        Supprimer
      </Button>
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
  // Ticket F-033 (audit des états système, vague 1) — même défaut que
  // MissionsListView (voir son docstring) : l'effet ci-dessous n'attrapait
  // aucune erreur, laissant `loading` bloqué à `true` pour toujours en cas
  // d'échec IndexedDB, sans le moindre message.
  const [loadError, setLoadError] = useState(false);
  // Ticket F-033 (vague 3) — même principe que `useApiResource.refetch()` :
  // un compteur inclus dans les deps de l'effet, pour que le bouton
  // "Réessayer" relance le chargement sans dupliquer sa logique.
  const [reloadToken, setReloadToken] = useState(0);
  // Ticket F-033 (vague 4) — voir `persist()` ci-dessous : portillon
  // EXPLICITE (pas une promesse rejetée) qui empêche les tentatives
  // d'écriture individuelles pendant une panne, jusqu'à un retry réussi.
  const [persistError, setPersistError] = useState(false);
  const [retryingPersist, setRetryingPersist] = useState(false);
  // Ticket F-034 — même défaut que `persist()` avant son correctif (F-033
  // vague 4), voir `resolveConflictByDiscarding` plus bas : portillon
  // EXPLICITE (pas une promesse rejetée silencieusement) pour signaler un
  // échec d'abandon de saisie en conflit.
  const [resolveConflictError, setResolveConflictError] = useState(false);
  const [resolvingConflict, setResolvingConflict] = useState(false);

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
    setLoadError(false);
    (async () => {
      // Ticket 012 : la mission vient désormais du cache local
      // (`getCachedMission`), jamais de `MOCK_MISSIONS` (retiré) — chargée
      // en parallèle du brouillon, pas de dépendance entre les deux.
      let existing: InspectionDraft | undefined;
      let cachedMission: Mission | undefined;
      try {
        [existing, cachedMission] = await Promise.all([
          getDraftForMission(missionId),
          getCachedMission(missionId),
        ]);
      } catch {
        if (!cancelled) {
          setLoading(false);
          setLoadError(true);
        }
        return;
      }
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
  }, [missionId, reloadToken]);

  /**
   * Ticket F-033 (vague 4) — AVANT ce ticket, un échec d'écriture (quota
   * dépassé, IndexedDB bloquée par une mise à jour de version, navigation
   * privée...) laissait `persistChainRef.current` sur une promesse
   * REJETÉE : chaque `persist()` suivant, `queue.then(onFulfilled)` sur
   * une promesse déjà rejetée ne s'exécutant JAMAIS, devenait un no-op
   * d'écriture silencieux — la mise à jour optimiste continuait de
   * s'afficher normalement à l'écran, mais plus rien n'était plus jamais
   * réellement enregistré, sans le moindre signal, jusqu'à la fermeture de
   * l'app (perte de toute saisie non confirmée).
   *
   * Corrigé en INTERNALISANT l'échec dans la chaîne elle-même (`.catch`
   * ci-dessous) : `persistChainRef.current` reste TOUJOURS une promesse
   * SAINE, `persistError` (état React, pas la promesse) est l'unique
   * portillon qui empêche désormais les tentatives d'écriture
   * individuelles suivantes — voir `retryPersist()`, qui réutilise cette
   * MÊME `persistChainRef`/`draftRef`, jamais un second chemin d'écriture
   * parallèle.
   */
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

    if (persistError) {
      // Une panne est déjà connue : ne tente plus d'écriture individuelle
      // (elle échouerait de toute façon) — `retryPersist()` capturera
      // CETTE saisie, et toutes les autres accumulées depuis, via
      // `draftRef.current` au prochain clic sur "Réessayer".
      return Promise.resolve(next);
    }

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
    }).catch(() => {
      setPersistError(true);
      // Résout (ne rejette PAS) : `next`, la valeur optimiste déjà
      // affichée, reste la référence — `persistChainRef.current` reste un
      // maillon SAIN pour ne jamais bloquer un futur `retryPersist()`
      // réussi. C'est `persistError` (portillon ci-dessus), pas l'état de
      // la promesse, qui empêche désormais les tentatives suivantes.
      return next;
    });
    persistChainRef.current = nextInChain;
    return nextInChain;
  }

  /**
   * Seule façon de sortir de `persistError` — action EXPLICITE de
   * l'inspecteur, jamais une nouvelle tentative automatique en arrière-plan
   * (même discipline que `resolveConflictByDiscarding` : un problème
   * visible attend une décision consciente, pas un retry silencieux qui
   * masquerait le problème sans le résoudre).
   *
   * Sauvegarde l'état COMPLET actuellement en mémoire (`draftRef.current`),
   * JAMAIS une mutation isolée : un retry naïf qui rejouerait seulement la
   * dernière modification sur la base IndexedDB (périmée depuis la panne)
   * perdrait silencieusement toutes les saisies faites ENTRE-TEMPS — c'est
   * précisément ce qui distingue ce correctif d'un simple `catch`.
   */
  async function retryPersist() {
    const current = draftRef.current;
    if (!current) return;

    setRetryingPersist(true);
    const queue = persistChainRef.current ?? Promise.resolve(current);
    const nextInChain = queue.then(async () => {
      // Même relecture fraîche que `persist()` ci-dessus — préserve les
      // champs pilotés par le moteur de synchro, mais applique l'état
      // COMPLET de `current`, jamais une mutation isolée.
      const freshBase = (await getDraft(current.id)) ?? current;
      return saveDraft({
        ...freshBase,
        checklist: current.checklist,
        comment: current.comment,
        decision: current.decision,
        photos: current.photos,
      });
    }).then((saved) => {
      if (draftRef.current === current) {
        draftRef.current = saved;
        setDraft(saved);
        setPersistError(false);
      }
      // Sinon : une saisie plus récente est arrivée PENDANT ce retry — le
      // bandeau reste affiché, un second clic la capturera (IndexedDB
      // n'étant plus périmée à ce stade, ce second retry partira d'une
      // base déjà à jour).
      return saved;
    }).catch(() => {
      // Reste en échec — le bandeau reste affiché, réessayable à volonté.
      return current;
    }).finally(() => {
      setRetryingPersist(false);
    });
    persistChainRef.current = nextInChain;
    await nextInChain;
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
   *
   * Ticket F-034 — AVANT ce ticket, un échec `deleteDraft` (quota dépassé,
   * IndexedDB bloquée, navigation privée...) n'était jamais catché : la
   * promesse rejetait silencieusement (rejection non gérée), le bouton
   * « Ignorer ma saisie et recommencer » semblait ne rien faire, sans le
   * moindre signal — même classe de bug que `persist()` avant son propre
   * correctif (F-033 vague 4), sévérité plus faible ici (aucune file
   * d'écriture partagée n'est poisonnée par cet échec : le brouillon en
   * conflit reste affiché tel quel, rien n'est perdu). Corrigé avec le
   * MÊME mécanisme que `persist()`/`retryPersist()` : portillon EXPLICITE
   * en état React (jamais une promesse rejetée silencieusement), bandeau
   * dédié visible avec un retry. Contrairement à `persist()`, aucune
   * saisie accumulée à fusionner lors d'un retry : `deleteDraft` +
   * `createEmptyDraft` est une action idempotente, rejouer EXACTEMENT la
   * même fonction suffit — pas de second chemin parallèle à construire.
   */
  async function resolveConflictByDiscarding() {
    if (!draft) return;
    setResolvingConflict(true);
    try {
      await deleteDraft(draft.id);
      const fresh = createEmptyDraft(missionId, CHECKLIST_TEMPLATE);
      setDraft(fresh);
      // Repart d'une file neuve sur ce brouillon neuf — jamais chaînée sur
      // la file de l'ancien brouillon abandonné (voir `persist` ci-dessus).
      persistChainRef.current = Promise.resolve(fresh);
      setResolveConflictError(false);
    } catch {
      setResolveConflictError(true);
    } finally {
      setResolvingConflict(false);
    }
  }

  if (loading) {
    return <p>Chargement…</p>;
  }
  if (loadError) {
    return (
      <AlertBanner
        title="Impossible de charger cette mission."
        onRetry={() => setReloadToken((token) => token + 1)}
      />
    );
  }
  if (!draft) {
    return <p>Chargement…</p>;
  }

  return (
    <section aria-label="Inspection" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div>
        {/* Ticket 024 (audit accessibilité) — `padding: 0` (posé au ticket
            023) réduisait la cible tactile bien en dessous de 44x44 malgré
            un contenu textuel minimal ; `minHeight`/`display:inline-flex`
            restaurent une cible correcte sans ajouter de bordure/fond
            visible (toujours un bouton "fantôme").
            Ticket F-044 — volontairement PAS migré vers `Button` : aucune
            des 3 variantes (`primary`/`secondary`/`danger`) ne rend un style
            "fantôme" (fond transparent, sans bordure) — les forcer via
            `style` reviendrait à écraser la quasi-totalité du composant pour
            n'en garder que `min-height`/`border-radius`, sans bénéfice
            réel. Un futur variant "ghost"/"tertiary" serait le bon endroit
            pour ce pattern, pas cette migration. */}
        <button
          type="button"
          onClick={onBack}
          style={{
            border: 'none',
            background: 'transparent',
            padding: '0 4px',
            minHeight: '44px',
            display: 'inline-flex',
            alignItems: 'center',
            color: semanticColors.neutral.textMuted,
          }}
        >
          ← Missions
        </button>
        <h1 style={{ margin: '8px 0 4px' }}>{mission ? `${mission.lotName} — ${mission.assetName}` : missionId}</h1>
        {mission && <p style={{ margin: 0, color: semanticColors.neutral.textMuted }}>{mission.programName} · {mission.milestoneLabel}</p>}
      </div>

      <SyncStatusIndicator status={draft.syncStatus} />

      {persistError && (
        <AlertBanner
          title="Échec de l'enregistrement local."
          onRetry={() => { void retryPersist(); }}
          retryLabel={retryingPersist ? 'Nouvelle tentative…' : "Réessayer l'enregistrement"}
        >
          Votre dernière saisie n&apos;a pas pu être enregistrée sur cet appareil. Elle reste
          affichée à l&apos;écran, mais serait perdue si vous fermiez l&apos;application maintenant.
        </AlertBanner>
      )}

      {draft.syncStatus === 'conflict' && (
        <>
          <AlertBanner title="Conflit à résoudre">
            Cette inspection a déjà été modifiée par ailleurs depuis votre dernière saisie
            {draft.conflict?.currentEventSource ? ` (dernier événement serveur : ${draft.conflict.currentEventSource})` : ''}.
            Votre saisie n'a PAS été envoyée pour éviter d'écraser cette modification.
            <div>
              {/* Ticket F-044 — `variant="danger"`, pas `secondary` : cette
                  action EXÉCUTE (en un seul clic, aucune arme préalable)
                  l'abandon définitif de la saisie locale de l'inspecteur —
                  déjà présentée dans le contexte d'alerte du bandeau conflit
                  ci-dessus, qui fait office d'avertissement. Cohérent avec
                  la doctrine `danger` (F-038) : réservé à ce qui EXÉCUTE
                  réellement une action irréversible. */}
              <Button
                type="button"
                variant="danger"
                onClick={() => void resolveConflictByDiscarding()}
                disabled={resolvingConflict}
              >
                {resolvingConflict ? 'Abandon en cours…' : 'Ignorer ma saisie et recommencer'}
              </Button>
            </div>
          </AlertBanner>
          {resolveConflictError && (
            <AlertBanner
              title="Échec de l'abandon de la saisie."
              onRetry={() => void resolveConflictByDiscarding()}
              retryLabel={resolvingConflict ? 'Nouvelle tentative…' : 'Réessayer'}
            >
              Votre saisie en conflit reste affichée telle quelle — rien n&apos;a été perdu ni modifié.
            </AlertBanner>
          )}
        </>
      )}

      <fieldset style={FIELDSET_STYLE}>
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

      <fieldset style={FIELDSET_STYLE}>
        <legend>Photos</legend>
        <label>
          Ajouter une photo
          <Input
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            aria-label="Ajouter une photo"
            onChange={handlePhotoAdd}
          />
        </label>
        <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
          {draft.photos.map((photo) => (
            <PhotoThumbnail key={photo.id} photo={photo} onRemove={() => handlePhotoRemove(photo.id)} />
          ))}
        </ul>
      </fieldset>

      <label style={{ display: 'block' }}>
        Commentaire
        {/* `key={draft.id}` : force un vrai remount quand le brouillon
            change d'identité (ex : abandon d'un conflit puis reprise sur un
            brouillon neuf, voir `resolveConflictByDiscarding` ci-dessus) —
            sans quoi `defaultValue` (non contrôlé, volontaire : voir
            docstring plus haut) resterait figé sur l'ancien commentaire,
            React ne réappliquant jamais `defaultValue` sur un composant déjà
            monté. */}
        <textarea
          key={draft.id}
          defaultValue={draft.comment}
          onBlur={handleCommentBlur}
          rows={3}
          style={{ display: 'block', width: '100%', marginTop: '4px', resize: 'vertical' }}
        />
      </label>

      <fieldset style={FIELDSET_STYLE}>
        <legend>Décision</legend>
        <label style={{ minHeight: '44px', display: 'inline-flex', alignItems: 'center', marginRight: '16px' }}>
          <input
            type="radio" name="decision" value="conforme"
            checked={draft.decision === 'conforme'}
            onChange={() => handleDecisionChange('conforme')}
          />
          Conforme
        </label>
        <label style={{ minHeight: '44px', display: 'inline-flex', alignItems: 'center' }}>
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
