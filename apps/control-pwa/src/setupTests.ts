import { Blob as NodeBlob } from 'node:buffer';

import '@testing-library/jest-dom/vitest';

// jsdom n'implémente pas IndexedDB — `fake-indexeddb` fournit une vraie
// implémentation (en mémoire, par processus) du même contrat que
// l'IndexedDB natif d'un navigateur. Ce n'est PAS un mock de notre code :
// nos fonctions `src/db/*` tournent pour de vrai contre cette
// implémentation, avec de vraies transactions et une vraie sémantique de
// fermeture/réouverture de connexion — indispensable pour que
// `repository.test.ts` prouve réellement la persistance au sens du
// critère d'acceptation du ticket 010, pas seulement qu'un mock répond
// aux bonnes valeurs.
import 'fake-indexeddb/auto';

// Piège rencontré en écrivant le test de persistance des photos : le Blob
// de jsdom (utilisé par défaut pour tout "new Blob(...)" dans cet
// environnement de test) n'est PAS reconnu par structuredClone — un Blob
// jsdom cloné revient comme un objet générique SANS ses méthodes (.text()
// etc.), silencieusement. fake-indexeddb utilise ce même mécanisme de
// clonage en interne pour simuler l'algorithme de structured clone qu'utilise
// un vrai IndexedDB de navigateur. Un vrai navigateur n'a pas ce problème
// (son propre Blob natif est nativement compatible) — ce correctif ne
// change donc RIEN au comportement réel, il aligne uniquement
// l'environnement de test dessus. Sans lui, un test de persistance de photo
// "réussirait" en comparant des objets vides des deux côtés, sans jamais
// prouver que le contenu binaire survit — un faux positif dangereux pour
// EXACTEMENT le critère d'acceptation central de cette passe.
globalThis.Blob = NodeBlob as unknown as typeof Blob;

// jsdom n'implémente pas non plus URL.createObjectURL/revokeObjectURL
// (utilisés pour prévisualiser une photo capturée sans repasser par une
// lecture asynchrone du Blob) — polyfill minimal pour que les tests de
// composant ne plantent pas sur un appel réellement supporté par tout vrai
// navigateur.
if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = () => `blob:mock-${Math.random().toString(36).slice(2)}`;
}
if (typeof URL.revokeObjectURL !== 'function') {
  URL.revokeObjectURL = () => undefined;
}
