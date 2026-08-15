# Ticket 011 — Messagerie tracée et back-office minimal

## Objectif
Éviter que les échanges entre acteurs d'un même lot ne se fassent hors plateforme
(WhatsApp) dès le pilote, ce qui casserait la chaîne de preuve dès le premier usage
réel (angle mort identifié dans le complément V4.0, section 1). Donner à l'équipe
KEYIMMO un minimum de visibilité/action sur les comptes.

## Entités touchées
- `Message` (rattaché à un objet métier : lot, réserve, document)
- Back-office : pas de nouvelle entité, endpoints d'administration sur `User` /
  `Organization` déjà existants

## Scope inclus
- `Message` simple : texte, auteur, objet référencé, horodatage — pas de pièce jointe
  au MVP (une pièce jointe doit passer par le circuit `Document` existant si besoin)
- Fil de discussion visible par tous les membres ayant accès à l'objet référencé
  (scope hérité des permissions existantes, pas de nouvelle logique de permission)
- Back-office minimal (accessible seulement au rôle `admin_keyimmo`) : recherche d'un
  utilisateur, consultation de son organisation/rôle, désactivation de compte

## Critères d'acceptation
- [ ] Un message est toujours rattaché à un objet métier existant, jamais une
      messagerie libre sans contexte
- [ ] Désactiver un compte depuis le back-office bloque l'accès immédiatement sans
      supprimer aucune donnée historique (TrustEvent, messages, preuves restent intacts)
- [ ] Le back-office n'expose aucune action qui court-circuiterait un TrustEvent
      (ex: pas de bouton "forcer un statut vérifié")

## Explicitement hors scope
- Notifications temps réel (websocket) — le MVP peut se contenter d'un rafraîchissement
  à la consultation
- Modération de contenu automatisée

## Dépendances
Tickets 001, 002, 006.
