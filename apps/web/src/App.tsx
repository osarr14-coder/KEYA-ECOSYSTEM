import { useMemo, useState } from 'react';

import {
  AlertBanner, ApiErrorBanner, AppShell, BRAND_GRADIENT, Button, Field, Input, brandColors, typography,
  useIsMobile, useOnlineStatus, type AppModule, type IconName, logoutToLoginScreen,
} from '@keya/design-system';

import { useApiClient } from './api/ApiClientContext';
import { ApiError } from './api/client';
import { useApiResource } from './api/useApiResource';
import {
  ADMIN_KEYIMMO_ROLE, FINANCE_ROLE, GESTIONNAIRE_ADV_ROLE, deriveAllRoleCodes, hasBackofficeAccess,
} from './auth/adminAccess';
import {
  isSameOriginRedirect,
} from './auth/redirectTarget';
import type { TabRoute } from './navigation/tabRouting';
import { useUrlSyncedTab } from './navigation/useUrlSyncedTab';
import { BackofficeView } from './views/BackofficeView';
import { ControlsView } from './views/ControlsView';
import { JournalView } from './views/JournalView';
import { DevisView } from './views/DevisView';
import { FinanceAccountsView } from './views/FinanceAccountsView';
import { LegalPaymentTiersView } from './views/LegalPaymentTiersView';
import { LotsCommercialView } from './views/LotsCommercialView';
import { PaymentNoticesView } from './views/PaymentNoticesView';
import { PricingView } from './views/PricingView';
import { ProgramRequestsView } from './views/ProgramRequestsView';
import { ProgramsView } from './views/ProgramsView';
import { ReservationsView } from './views/ReservationsView';
import { type NavigationTarget, TodayView } from './views/TodayView';
import { signInAndRedirect } from './auth/signInAndRedirect';
import { PublicHome } from './public/PublicHome';
import { PublicLayout } from './public/PublicLayout';
import { AccessView } from './public/AccessView';
import { type PublicPath, usePublicPath } from './public/usePublicPath';

type AuthenticatedTabId =
  'backoffice' | 'devis' | 'pricing' | 'legal-tiers' | 'lots' | 'reservations' | 'finance' | 'programs'
  | 'program-requests' | 'controls' | 'payment-notices' | 'todo' | 'journal';

/**
 * Source UNIQUE id/label/chemin des 5 onglets admin — ticket F-031 :
 * `MODULES` (sidebar `AppShell`) et `TABS` (`TabBar`) en étaient deux copies
 * manuellement synchronisées depuis le ticket F-030 (id/label dupliqués,
 * jamais le chemin pour `TabBar`, qui ne connaissait pas encore l'URL avant
 * ce ticket) — dérivés ci-dessous plutôt que dupliqués une troisième fois.
 * `path` alimente aussi `TAB_ROUTES` (`useUrlSyncedTab`, ci-dessous) :
 * réservé à admin_keyimmo (`requiredRoles`), défense en profondeur en plus
 * de la garde déjà faite dans `AuthenticatedApp`, même discipline que RLS +
 * filtre applicatif ailleurs dans ce projet (CLAUDE.md).
 *
 * Ticket F-049 — `programs` ajouté (création Program/Asset/Lot, voir
 * `ProgramsView.tsx`), suite du gatekeeping API posé par B-039.
 *
 * Ticket F-051 — `group` (optionnel, `AppShell`) regroupe Devis/Tarifs/
 * Paliers légaux sous « Ventes & tarification » dans la sidebar : premier
 * usage réel du regroupement introduit par ce ticket, apps/web étant la
 * seule app à avoir assez d'onglets pour en justifier un (5, contre 1 à 4
 * ailleurs) — Back-office et Programmes restent des entrées de premier
 * niveau, chacune un domaine distinct. `TABS`/`TAB_ROUTES` ci-dessous
 * n'en ont pas besoin (TabBar reste plate, jamais concernée par ce champ).
 *
 * Ticket F-065 — `roles` : l'ADV (équipe KEYIMMO) n'y voit que la
 * préparation et la commercialisation des programmes (Programmes, Demandes,
 * Lots). Même périmètre que `IsAdminKeyimmoOrGestionnaireADV` côté backend,
 * qui reste la vraie garde : ce filtre n'évite que des écrans en 403.
 */
// Audit UI R1 (R02, PO-2026-09-27-09) — l'administrateur n'a AUCUN pouvoir
// métier : comptes, paliers du Country Pack, journal en lecture seule. Les
// écrans métier passent au gestionnaire (ADV) et à Finance. Même périmètre
// que les permissions serveur (`IsGestionnaireADV`, `IsKeyimmoTeam`,
// `IsAdminKeyimmo`), qui restent la vraie garde.
const ADMIN_ONLY = [ADMIN_KEYIMMO_ROLE];
const ADV_ONLY = [GESTIONNAIRE_ADV_ROLE];
// Ticket F-068 — Finance : réservations (dossiers financiers) et comptes
// des programmes. Même périmètre que `IsKeyimmoTeam` côté backend.
const KEYIMMO_TEAM = [GESTIONNAIRE_ADV_ROLE, FINANCE_ROLE];

/*
 * Ticket F-075 (direction « Confiance premium ») — navigation UNIQUE par la
 * barre latérale (plus de `TabBar` en double), regroupée par métier :
 * « À faire » en tête (écran d'arrivée de toute l'équipe, chemin `/`), puis
 * Ventes, Finance, Chantier, Programmes, Administration. Le Back-office
 * (recherche d'utilisateurs) passe sous `/back-office`.
 */
const TAB_DEFINITIONS: {
  id: AuthenticatedTabId; label: string; path: string; icon: IconName; group?: string; roles: string[];
}[] = [
  // Ticket F-075 — reprend l'ancien écran « Tâches » (F-061/F-063).
  {
    id: 'todo', label: 'À faire', path: '/', icon: 'bell', roles: KEYIMMO_TEAM,
  },
  // Ticket F-067 — cycle de réservation (backend B-048), présenté en
  // dossiers clients (F-075).
  {
    id: 'reservations', label: 'Dossiers clients', path: '/reservations', icon: 'clipboard-check', group: 'Ventes', roles: KEYIMMO_TEAM,
  },
  // Ticket F-071 — virements déclarés par les clients, confirmés par
  // Finance (backend B-056).
  {
    id: 'payment-notices', label: 'Virements déclarés', path: '/virements', icon: 'wallet', group: 'Ventes', roles: KEYIMMO_TEAM,
  },
  // Ticket F-064 — prix et statut commercial des lots existants.
  {
    id: 'lots', label: 'Lots — prix & statut', path: '/lots', icon: 'wallet', group: 'Ventes', roles: ADV_ONLY,
  },
  // Ticket F-068 — comptes simulés et décaissements (backend B-052).
  {
    id: 'finance', label: 'Comptes & décaissements', path: '/finance', icon: 'wallet', group: 'Finance', roles: KEYIMMO_TEAM,
  },
  // Ticket F-069 — affectation des contrôles de chantier (backend B-054),
  // admin seul comme `POST /api/backoffice/missions/` (ticket 012).
  {
    id: 'controls', label: 'Contrôles à affecter', path: '/controles', icon: 'shield-check', group: 'Chantier', roles: ADV_ONLY,
  },
  // Ticket F-049 — création Program/Asset/Lot ; F-058 — demandes sur mesure.
  {
    id: 'programs', label: 'Programmes', path: '/programmes', icon: 'building', group: 'Programmes', roles: ADV_ONLY,
  },
  {
    id: 'program-requests', label: 'Demandes de programme', path: '/demandes-programme', icon: 'clipboard-check', group: 'Programmes', roles: ADV_ONLY,
  },
  {
    id: 'backoffice', label: 'Utilisateurs', path: '/back-office', icon: 'shield-check', group: 'Administration', roles: ADMIN_ONLY,
  },
  {
    id: 'journal', label: 'Journal', path: '/journal', icon: 'file-text', group: 'Administration', roles: ADMIN_ONLY,
  },
  {
    id: 'devis', label: 'Devis / Appels d\'offres', path: '/devis', icon: 'file-text', group: 'Administration', roles: ADMIN_ONLY,
  },
  {
    id: 'pricing', label: 'Tarifs', path: '/tarifs', icon: 'wallet', group: 'Administration', roles: ADMIN_ONLY,
  },
  {
    id: 'legal-tiers', label: 'Paliers légaux', path: '/paliers-legaux', icon: 'scale', group: 'Administration', roles: ADMIN_ONLY,
  },
];

const MODULES: AppModule[] = TAB_DEFINITIONS.map(({
  id, label, path, icon, group, roles,
}) => ({
  id, label, href: path, requiredRoles: roles, icon, group,
}));

function visibleTabDefinitions(userRoles: string[]) {
  return TAB_DEFINITIONS.filter((tab) => tab.roles.some((role) => userRoles.includes(role)));
}

export interface AppProps {
  redirect?: (url: string) => void;
}

/**
 * Ticket 021 — bug réel trouvé en vérifiant ce parcours dans un vrai
 * navigateur (voir `isSameOriginRedirect` dans `auth/redirectTarget.ts` pour
 * le détail) : `window.location.assign(url)` seul ne recharge PAS le
 * document quand `url` ne diffère de la page courante que par le fragment
 * — exactement le cas d'un `admin_keyimmo` qui se redirige vers apps/web
 * elle-même. Un rechargement explicite est donc forcé dans ce cas précis,
 * jamais pour HOME/BUILD/CONTROL (origine différente, déjà rechargées par
 * la navigation elle-même — un second rechargement y serait un no-op
 * inoffensif mais inutile, évité par la condition ci-dessous).
 */
function defaultRedirect(url: string) {
  const needsExplicitReload = isSameOriginRedirect(url, window.location.href);
  window.location.assign(url);
  if (needsExplicitReload) {
    window.location.reload();
  }
}

/**
 * Ticket 021 : apps/web n'est plus SEULEMENT un écran de connexion (ticket
 * 020) — un `admin_keyimmo` peut désormais s'y rediriger LUI-MÊME (voir
 * `auth/redirectTarget.ts`), auquel cas `main.tsx` a déjà posé le token en
 * `localStorage` (via `receiveIncomingSession`) AVANT ce premier rendu. Un
 * token présent = session de back-office active ; son absence = pas encore
 * connecté, comportement du ticket 020 strictement inchangé (formulaire de
 * connexion, voir `LoginView`).
 *
 * Lu une seule fois à l'initialisation du state (pas à chaque rendu) — la
 * bascule connexion → back-office se fait par une VRAIE navigation
 * (`redirect`, ticket 020), qui redémarre `main.tsx` depuis zéro, jamais par
 * un changement d'état à l'intérieur de ce composant.
 */
export function App({ redirect = defaultRedirect }: AppProps) {
  const [storedAccessToken] = useState(() => localStorage.getItem('keya_access_token'));
  // Ticket F-033 (vague 2) — implémentation UNIQUE promue au design system
  // (`useOnlineStatus`, extraite de CONTROL PWA, ticket 010 passe 2) :
  // couvre à la fois l'écran de connexion et le back-office authentifié,
  // une coupure réseau ne doit plus ressembler à une erreur générique.
  const isOnline = useOnlineStatus();

  return (
    <>
      {!isOnline && (
        <div style={{ padding: '12px' }}>
          <AlertBanner title="Hors ligne">
            Les actions nécessitant le réseau échoueront tant que la connexion n&apos;est pas rétablie.
          </AlertBanner>
        </div>
      )}
      {storedAccessToken ? <AuthenticatedApp /> : <PublicSite redirect={redirect} />}
    </>
  );
}

function AuthenticatedApp() {
  const api = useApiClient();
  const meState = useApiResource(() => api.getMe(), []);

  if (meState.status === 'loading') {
    return <p style={{ padding: '24px' }}>Chargement…</p>;
  }
  if (meState.status === 'error') {
    return (
      <main style={{ padding: '24px' }}>
        <ApiErrorBanner error={meState.error} title="Impossible de charger votre profil." onRetry={meState.refetch} />
        <Button type="button" variant="secondary" onClick={() => logoutToLoginScreen()} style={{ marginTop: '12px' }}>
          Se déconnecter
        </Button>
      </main>
    );
  }

  const me = meState.data;
  const userRoles = deriveAllRoleCodes(me);

  // Ticket 021, point 1 du scope : écran réservé à admin_keyimmo. Vérifié
  // ici (jamais un rendu, même partiel, du back-office pour un autre rôle)
  // EN PLUS de la garde backend (`IsAdminKeyimmo`, ticket 011) — pas à sa
  // place. Voir `auth/adminAccess.ts` pour pourquoi cette vérification
  // regarde TOUTES les memberships, pas seulement la première. S'applique
  // aussi à la maquette Devis (ticket 025) — même garde, jamais un second
  // mécanisme d'accès parallèle.
  if (!hasBackofficeAccess(me)) {
    return (
      <main style={{ padding: '24px' }}>
        <AlertBanner title="Accès refusé">
          Cet écran est réservé à l&apos;équipe KEYIMMO (rôles admin_keyimmo, gestionnaire_adv et finance).
        </AlertBanner>
        {/* Ticket F-070 — jamais une impasse : changer de compte. */}
        <Button type="button" variant="secondary" onClick={() => logoutToLoginScreen()} style={{ marginTop: '12px' }}>
          Se déconnecter
        </Button>
      </main>
    );
  }

  return <AuthenticatedTabs userRoles={userRoles} />;
}

/**
 * Ticket 025 — bascule entre le back-office (ticket 021, fonctionnel) et
 * l'écran Devis/Appels d'offres (maquette au ticket 025/026, fonctionnel
 * depuis le ticket 027, voir `DevisView.tsx`). Même `TabBar` déjà réutilisé
 * par HOME/BUILD (ticket 023), jamais un second mécanisme d'onglets.
 *
 * Ticket F-031 : l'onglet actif est désormais synchronisé avec l'URL
 * (`useUrlSyncedTab`) plutôt qu'un simple `useState` — chaque écran admin a
 * sa propre URL, le bouton retour du navigateur fonctionne, un lien direct
 * survit à un rechargement de page.
 */
function AuthenticatedTabs({ userRoles }: { userRoles: string[] }) {
  const api = useApiClient();
  const isAdv = userRoles.includes(GESTIONNAIRE_ADV_ROLE);
  const isFinance = userRoles.includes(FINANCE_ROLE);
  // Ticket F-065 — onglets du rôle courant (les rôles ne changent pas en
  // cours de session). Premier onglet visible = repli : un ADV qui arrive
  // sur `/` (Back-office, admin seul) ou un lien vers un onglet admin est
  // ramené sur « Lots — prix & statut ».
  const visibleTabs = useMemo(() => visibleTabDefinitions(userRoles), [userRoles.join(',')]);
  const tabRoutes: TabRoute<AuthenticatedTabId>[] = visibleTabs.map(({ id, path }) => ({ id, path }));
  const [activeTab, setActiveTab] = useUrlSyncedTab(tabRoutes, visibleTabs[0].id);
  // Ticket F-075 — dossier à ouvrir directement (depuis « À faire »).
  const [dossier, setDossier] = useState<{ id: string; nonce: number } | null>(null);
  // Ticket F-060/F-063/F-071 — boîte PERSONNELLE transverse (cloche et
  // compteur de « À faire ») : l'ADV y reçoit « Réservation à valider » /
  // « Paiement reçu », Finance « Virement déclaré à confirmer ».
  const taskInboxState = useApiResource(() => api.getMyInboxTasks({ status: 'pending' }), [activeTab]);
  const pendingCount = taskInboxState.status === 'success' ? taskInboxState.data.length : 0;
  const modules: AppModule[] = MODULES.map((module) => (module.id === 'todo' ? { ...module, badge: pendingCount } : module));

  function navigate(target: NavigationTarget) {
    setDossier(target.reservationId ? { id: target.reservationId, nonce: Date.now() } : null);
    setActiveTab(target.tab as AuthenticatedTabId);
  }

  return (
    <AppShell
      // Ticket F-070 — déconnexion volontaire, vers l'écran de connexion.
      onLogout={() => logoutToLoginScreen()}
      density="dense"
      brand
      appLabel="Back-office KEYIMMO"
      modules={modules}
      userRoles={userRoles}
      activeModuleId={activeTab}
      onModuleSelect={(id) => navigate({ tab: id })}
      taskInboxCount={pendingCount}
      // Ticket F-061/F-075 — la cloche ouvre « À faire », URL synchronisée.
      onTaskInboxClick={() => navigate({ tab: 'todo' })}
    >
      {activeTab === 'todo' && (
        <TodayView
          onNavigate={navigate}
          availableTabs={visibleTabs.map((tab) => tab.id)}
          showSales={visibleTabs.some((tab) => tab.id === 'reservations')}
          showPaymentNotices={visibleTabs.some((tab) => tab.id === 'payment-notices')}
        />
      )}
      {activeTab === 'backoffice' && <BackofficeView />}
      {activeTab === 'journal' && <JournalView />}
      {activeTab === 'devis' && <DevisView />}
      {activeTab === 'pricing' && <PricingView />}
      {activeTab === 'legal-tiers' && <LegalPaymentTiersView />}
      {activeTab === 'lots' && <LotsCommercialView canEditPrice={isAdv} />}
      {activeTab === 'reservations' && (
        <ReservationsView
          key={dossier ? `${dossier.id}-${dossier.nonce}` : 'list'}
          openReservationId={dossier?.id ?? null}
          permissions={{ canManageSales: isAdv, canRecordMovements: isFinance }}
        />
      )}
      {activeTab === 'payment-notices' && <PaymentNoticesView canAct={isFinance} />}
      {activeTab === 'finance' && <FinanceAccountsView canAct={isFinance} />}
      {activeTab === 'programs' && <ProgramsView />}
      {activeTab === 'program-requests' && <ProgramRequestsView />}
      {activeTab === 'controls' && <ControlsView />}
    </AppShell>
  );
}

/**
 * Écran de connexion (ticket 020) — formulaire → `POST /api/auth/login/` →
 * `GET /api/me/` → redirection vers l'app correspondant au RÔLE réel de
 * l'utilisateur (voir `auth/redirectTarget.ts`). Extrait de `App` au ticket
 * 021 pour cohabiter avec `AuthenticatedApp` ci-dessus — comportement et
 * markup strictement inchangés.
 */
/**
 * Ticket F-079 — sans session : pages publiques (accueil `/`, connexion
 * `/connexion`, accès sur invitation `/acces` — audit R01), dans le même gabarit.
 */
function PublicSite({ redirect }: { redirect: (url: string) => void }) {
  const [path, navigate] = usePublicPath();
  return (
    <PublicLayout path={path} navigate={navigate}>
      {path === '/connexion' && <LoginView redirect={redirect} navigate={navigate} />}
      {path === '/acces' && <AccessView navigate={navigate} />}
      {path === '/' && <PublicHome navigate={navigate} />}
    </PublicLayout>
  );
}

function LoginView({ redirect, navigate }: { redirect: (url: string) => void; navigate: (path: PublicPath) => void }) {
  const api = useApiClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ticket F-053 — même seuil/hook que le reste du projet (MOBILE_BREAKPOINT_PX
  // via useIsMobile, AppShell.tsx), jamais une valeur ad hoc : le panneau
  // navy narratif serait trop à l'étroit à côté du formulaire sous ce seuil.
  const isMobile = useIsMobile();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await signInAndRedirect(api, email, password, redirect);
      // Volontairement PAS de `setSubmitting(false)` ici : une redirection
      // réelle va démonter ce composant, remettre le formulaire actif
      // entre-temps ne ferait que clignoter avant la navigation.
    } catch (caught) {
      // Ticket 020, vérifié empiriquement : identifiants invalides, compte
      // désactivé (`is_active=False`, ticket 011) et email inexistant
      // renvoient TOUS le même 401 générique. Aucun message différencié
      // n'existe à afficher ici.
      if (caught instanceof ApiError && caught.status === 401) {
        setError('Identifiants invalides.');
      } else {
        setError('Une erreur est survenue. Réessayez.');
      }
      setSubmitting(false);
    }
  }

  // Ticket F-053 (refonte visuelle) — panneau narratif navy à gauche
  // (identité + doctrine Visible Trust, jamais affiché ailleurs qu'ici :
  // ce n'est pas un composant partagé, uniquement le point d'entrée de la
  // plateforme) / formulaire à droite, remplace le <form> nu centré.
  // Structure d'accessibilité INCHANGÉE : aria-label="Connexion" sur le
  // <form>, Field dérive aria-label="Email"/"Mot de passe" du libellé
  // visible (voir Field.tsx) — mêmes requêtes getByLabelText qu'avant ce
  // ticket, aucune régression de test attendue.
  return (
    <div style={{ display: 'flex', minHeight: 'calc(100vh - 100px)' }}>
      <div
        style={{
          width: '440px',
          minWidth: '440px',
          display: isMobile ? 'none' : 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '48px',
          background: BRAND_GRADIENT,
          color: '#FFFFFF',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', position: 'relative' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '40px',
              height: '40px',
              borderRadius: '11px',
              background: `linear-gradient(135deg, ${brandColors.gold}, #E4C878)`,
              color: brandColors.navy,
              fontWeight: 700,
              fontFamily: typography.headingFontFamily,
              fontSize: '17px',
              boxShadow: 'var(--keya-shadow-sm)',
            }}
          >
            K+
          </span>
          <span style={{ fontFamily: typography.headingFontFamily, fontWeight: 600, fontSize: '18px' }}>KEYIMMO AFRIC</span>
        </div>

        <div style={{ position: 'relative' }}>
          <div style={{
            fontSize: '12px', letterSpacing: '0.12em', color: '#E4C878', textTransform: 'uppercase',
            fontWeight: 600, marginBottom: '16px',
          }}
          >
            Visible Trust
          </div>
          {/* Ticket F-053 — <p>, pas <h1> : un seul vrai titre de page
              (« Connexion à KEYIMMO AFRIC », dans le formulaire ci-dessous) reste
              nécessaire pour une structure de landmarks correcte, un
              second <h1> décoratif induirait les lecteurs d'écran en
              erreur sur la hiérarchie réelle de la page. */}
          <p style={{
            color: '#FFFFFF', maxWidth: '340px', fontFamily: typography.headingFontFamily,
            fontSize: '1.75em', fontWeight: 600, lineHeight: 1.25, margin: 0, textWrap: 'balance',
          }}
          >
            La confiance visible, à chaque étape du chantier.
          </p>
          <p style={{ marginTop: '16px', color: 'rgba(255,255,255,0.65)', maxWidth: '340px', lineHeight: 1.6 }}>
            Démonstration : chaque déclaration, pièce et avis est horodaté et conservé, sur des données fictives.
          </p>
        </div>

        <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', position: 'relative' }}>
          Accès sur invitation — comptes de démonstration fictifs.
        </div>
      </div>

      <div style={{
        flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px',
      }}
      >
        <form
          onSubmit={(event) => { void handleSubmit(event); }}
          aria-label="Connexion"
          style={{ display: 'flex', flexDirection: 'column', gap: '16px', width: '340px' }}
        >
          <h1 style={{ marginBottom: '4px' }}>Connexion à KEYIMMO AFRIC</h1>

          {error && <AlertBanner title={error} />}

          <Field label="Email">
            <Input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>

          <Field label="Mot de passe">
            <Input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>

          <Button type="submit" disabled={submitting}>
            {submitting ? 'Connexion…' : 'Se connecter'}
          </Button>
          {/* Ticket F-079 — un visiteur sans compte n'est jamais bloqué ici. */}
          <p style={{ margin: 0, fontSize: '14px' }}>
            Pas encore de compte ?{' '}
            <a
              href="/acces"
              onClick={(event) => { event.preventDefault(); navigate('/acces'); }}
              style={{ fontWeight: 700 }}
            >
              Accès sur invitation
            </a>
          </p>
        </form>
      </div>
    </div>
  );
}
