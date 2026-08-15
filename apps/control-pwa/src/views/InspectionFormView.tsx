import { useEffect, useState } from 'react';

import { AlertBanner } from '@keya/design-system';

import { SyncStatusIndicator } from '../components/SyncStatusIndicator';
import { CHECKLIST_TEMPLATE, MOCK_MISSIONS } from '../db/missions';
import { createEmptyDraft, deleteDraft, getDraftForMission, saveDraft } from '../db/repository';
import type { Decision, InspectionDraft, LocalPhoto } from '../db/types';

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
  const mission = MOCK_MISSIONS.find((item) => item.id === missionId);
  const [draft, setDraft] = useState<InspectionDraft | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const existing = await getDraftForMission(missionId);
      const initial = existing ?? createEmptyDraft(missionId, CHECKLIST_TEMPLATE);
      if (!cancelled) {
        setDraft(initial);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [missionId]);

  async function persist(next: InspectionDraft) {
    setDraft(next);
    const saved = await saveDraft(next);
    setDraft(saved);
  }

  function toggleChecklistItem(itemId: string) {
    if (!draft) return;
    void persist({
      ...draft,
      checklist: draft.checklist.map((item) => (
        item.id === itemId ? { ...item, checked: !item.checked } : item
      )),
    });
  }

  function handleCommentBlur(event: React.FocusEvent<HTMLTextAreaElement>) {
    if (!draft) return;
    void persist({ ...draft, comment: event.target.value });
  }

  function handleDecisionChange(decision: Decision) {
    if (!draft) return;
    void persist({ ...draft, decision });
  }

  async function handlePhotoAdd(event: React.ChangeEvent<HTMLInputElement>) {
    if (!draft || !event.target.files || event.target.files.length === 0) return;
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
    await persist({ ...draft, photos: [...draft.photos, ...newPhotos] });
    // Permet de recapturer/resélectionner le même fichier ensuite.
    event.target.value = '';
  }

  function handlePhotoRemove(photoId: string) {
    if (!draft) return;
    void persist({ ...draft, photos: draft.photos.filter((photo) => photo.id !== photoId) });
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
    setDraft(createEmptyDraft(missionId, CHECKLIST_TEMPLATE));
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
