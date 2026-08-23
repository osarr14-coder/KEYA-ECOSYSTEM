# F-052 — Signaler un doublon détecté à l'upload (Control Tower BUILD)

## Contexte

Suite du ticket B-040 (backend) : `Document.duplicate_of` est calculé à
l'upload mais jamais exposé dans une UI — explicitement laissé hors scope
de B-040, ticket frontend séparé annoncé à ce moment-là.

Seul flux d'upload de document avec une UI déjà construite : Control Tower
BUILD, section « Documents manquants » (`ExceptionsView.tsx`,
`DocumentManquantRow`), qui appelle `api.addEvidenceDocument` — enchaîne
`POST /api/documents/` (dont la réponse porte déjà `duplicate_of`, ticket
B-040) puis `POST /api/evidences/`. CONTROL PWA a un flux d'upload
équivalent (`SyncDocumentView`) mais sa réponse ne renvoie aujourd'hui que
`{id}` — hors scope ici (mécanisme de sync offline distinct, correlation
IDs, à traiter dans un ticket séparé si besoin).

## Décision UX

Un doublon n'est jamais bloquant (B-040) — mais si la ligne d'exception
disparaît immédiatement au rechargement (comportement actuel après
`onAdded()`), l'utilisateur n'a jamais l'occasion de voir l'avertissement.
Choix : sur un doublon détecté, la ligne reste visible avec le bandeau
d'alerte et un bouton « Continuer » explicite ; `onAdded()` (qui déclenche
le rechargement de la liste d'exceptions) n'est appelé qu'à ce moment,
jamais automatiquement. Sans doublon détecté, comportement inchangé :
`onAdded()` immédiat, comme avant ce ticket.

## Scope

- `apps/build/src/api/client.ts` — `addEvidenceDocument` type la réponse de
  `POST /api/documents/` avec `duplicate_of`, renvoie `{ duplicateOf }`.
- `apps/build/src/views/ExceptionsView.tsx` — `DocumentManquantRow` : état
  local `duplicateWarning`, bandeau `AlertBanner` + bouton « Continuer »
  quand un doublon est détecté, `onAdded()` différé jusqu'au clic.

## Hors scope

- CONTROL PWA (`SyncDocumentView`, flux offline) — mécanisme de sync
  différent (correlation IDs, file d'attente), ticket séparé si le besoin
  se confirme là aussi.
- Tout autre point d'upload (aucun autre n'a d'UI construite aujourd'hui).

## Critères d'acceptation

- Upload sans doublon (`duplicate_of` absent/`null`) : comportement
  inchangé, `onAdded()` appelé immédiatement, aucun bandeau affiché.
- Upload avec doublon détecté : la ligne reste affichée avec un bandeau
  d'alerte visible et un bouton « Continuer » ; `onAdded()` n'est appelé
  qu'au clic sur ce bouton.
- Aucune régression sur les tests existants de `ExceptionsView.test.tsx`.
