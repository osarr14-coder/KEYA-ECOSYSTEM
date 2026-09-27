# F-065 — Ouverture d'apps/web au gestionnaire ADV

## Contexte

Demande utilisateur : « Ouvre aussi apps/web à l'ADV ». Décision utilisateur antérieure
(ticket B-047) : l'ADV fait partie de l'équipe KEYIMMO. B-046 lui avait donné des droits
API (programmes/biens/lots, demandes de programme), F-064 un écran prix/statut, mais
`apps/web` restait entièrement gardée `admin_keyimmo` : un ADV connecté était redirigé vers
HOME (l'app client) et, s'il ouvrait `apps/web`, voyait « Accès refusé ».

## Scope

- **Accès** — `hasBackofficeAccess` (`auth/adminAccess.ts`) : `admin_keyimmo` OU
  `gestionnaire_adv`, dans n'importe quelle membership (même sémantique que
  `IsAdminKeyimmoOrGestionnaireADV` côté backend).
- **Redirection après connexion** — `gestionnaire_adv` → `web` (`auth/redirectTarget.ts`).
- **Onglets par rôle** (`App.tsx`, `TAB_DEFINITIONS[].roles`) — l'ADV voit « Lots — prix &
  statut », « Programmes », « Demandes de programme » ; Back-office, Devis, Tarifs,
  Paliers légaux et Tâches restent admin. Premier onglet visible = repli : un lien vers un
  onglet interdit ramène l'ADV sur « Lots — prix & statut », URL corrigée. Le backend reste
  la vraie garde ; ce filtre évite seulement d'afficher des écrans en 403.
- **Cloche des tâches** — nouvelle option `showTaskInbox` d'`AppShell` (design system,
  défaut `true`, aucune autre app modifiée) : masquée pour l'ADV, dont la boîte transverse
  (`/api/tasks/admin-inbox/`) est réservée à l'admin ; l'appel n'est jamais fait.
- **Prix de vente** — désactivé pour l'ADV dans « Lots — prix & statut », avec une
  explication, plutôt qu'un 403 à l'enregistrement (B-047).
- **Backend** — `GET /api/procurement/admin/organizations/` ouvert à l'ADV : l'assistant
  Programmes en a besoin pour désigner l'organisation cible. Ne renvoie que `id`/`name`.

## Hors scope

- Boîte de tâches propre à l'ADV : aucun générateur de tâche ne cible ce rôle aujourd'hui.
- Interface d'attribution du rôle `gestionnaire_adv` (bascule en base, comme les autres
  rôles, voir B-046).

## Critères d'acceptation

- Un ADV se connecte, arrive sur `apps/web`, onglet « Lots — prix & statut ».
- Il ne voit que ses trois onglets ; un lien direct vers un onglet admin le ramène sur le
  sien.
- Il peut créer un programme (recherche d'organisation comprise), décider une demande,
  changer le statut d'un lot ; le prix lui est présenté désactivé.
- Aucune requête vers une route admin ne part de sa session (cloche comprise).
- L'admin garde exactement ses onglets et sa cloche (non-régression).
- Suites backend, `apps/web` et design system vertes ; vérifié dans un vrai navigateur
  avec les deux rôles.
