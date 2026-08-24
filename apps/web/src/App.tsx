import { useState } from 'react';

import {
  AlertBanner, ApiErrorBanner, AppShell, BRAND_GRADIENT, Button, Field, Input, TabBar, brandColors, typography,
  useIsMobile, useOnlineStatus, type AppModule, type IconName,
} from '@keya/design-system';

import { useApiClient } from './api/ApiClientContext';
import { ApiError } from './api/client';
import { useApiResource } from './api/useApiResource';
import { deriveAllRoleCodes, hasAdminKeyimmoAccess } from './auth/adminAccess';
import {
  buildRedirectUrl, isSameOriginRedirect, resolveAppOrigins, resolveRedirectApp,
} from './auth/redirectTarget';
import type { TabRoute } from './navigation/tabRouting';
import { useUrlSyncedTab } from './navigation/useUrlSyncedTab';
import { BackofficeView } from './views/BackofficeView';
import { DevisView } from './views/DevisView';
import { LegalPaymentTiersView } from './views/LegalPaymentTiersView';
import { PricingView } from './views/PricingView';
import { ProgramRequestsView } from './views/ProgramRequestsView';
import { ProgramsView } from './views/ProgramsView';
import { TasksView } from './views/TasksView';

type AuthenticatedTabId = 'backoffice' | 'devis' | 'pricing' | 'legal-tiers' | 'programs' | 'program-requests' | 'tasks';

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
 */
const TAB_DEFINITIONS: { id: AuthenticatedTabId; label: string; path: string; icon: IconName; group?: string }[] = [
  { id: 'backoffice', label: 'Back-office', path: '/', icon: 'shield-check' },
  {
    id: 'devis', label: 'Devis / Appels d\'offres', path: '/devis', icon: 'file-text', group: 'Ventes & tarification',
  },
  {
    id: 'pricing', label: 'Tarifs', path: '/tarifs', icon: 'wallet', group: 'Ventes & tarification',
  },
  {
    id: 'legal-tiers', label: 'Paliers légaux', path: '/paliers-legaux', icon: 'scale', group: 'Ventes & tarification',
  },
  { id: 'programs', label: 'Programmes', path: '/programmes', icon: 'building' },
  // Ticket F-058 — pendant admin de ProgramRequestView.tsx (apps/home,
  // ticket F-057). Entrée de premier niveau, comme "Programmes" (pas
  // dans le groupe "Ventes & tarification" : une demande sur mesure
  // n'est ni un devis, ni un tarif, ni un palier légal).
  {
    id: 'program-requests', label: 'Demandes de programme', path: '/demandes-programme', icon: 'clipboard-check',
  },
  // Ticket F-061 — destination réelle de la cloche AppShell (jusqu'ici un
  // lien mort `href="/tasks"`, ticket F-045). Entrée de premier niveau,
  // comme "Programmes"/"Demandes de programme" : une tâche n'appartient à
  // aucun des groupes existants.
  { id: 'tasks', label: 'Tâches', path: '/tasks', icon: 'bell' },
];

const MODULES: AppModule[] = TAB_DEFINITIONS.map(({
  id, label, path, icon, group,
}) => ({
  id, label, href: path, requiredRoles: ['admin_keyimmo'], icon, group,
}));

const TABS: { id: AuthenticatedTabId; label: string; icon: IconName }[] = TAB_DEFINITIONS.map(
  ({ id, label, icon }) => ({ id, label, icon }),
);

const TAB_ROUTES: TabRoute<AuthenticatedTabId>[] = TAB_DEFINITIONS.map(
  ({ id, path }) => ({ id, path }),
);

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
      {storedAccessToken ? <AuthenticatedApp /> : <LoginView redirect={redirect} />}
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
  if (!hasAdminKeyimmoAccess(me)) {
    return (
      <main style={{ padding: '24px' }}>
        <AlertBanner title="Accès refusé">
          Cet écran est réservé aux membres du rôle admin_keyimmo.
        </AlertBanner>
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
  const [activeTab, setActiveTab] = useUrlSyncedTab(TAB_ROUTES, 'backoffice');
  // Ticket F-060/F-063 — câble le compteur de la cloche AppShell.
  // `getAdminTasks` (ticket B-044), pas `getMyTasks` : cette app est
  // réservée à `admin_keyimmo`, dont les tâches `devis_ajustement_refuse`/
  // `lot_ledger_margin_negative` ont l'organisation CIBLE, jamais celle
  // de KEIMMO — invisibles via l'endpoint mono-organisation.
  const taskInboxState = useApiResource(() => api.getAdminTasks({ status: 'pending' }), []);

  return (
    <AppShell
      density="dense"
      // Ticket F-056 (suite F-053/054/055) — révision de la doctrine 17.3 :
      // `brand` (bandeau <header> dégradé navy/or) était HOME-only depuis
      // F-048 ; retour utilisateur explicite demandant le même traitement
      // visuel complet sur le back-office — activé ici comme sur
      // apps/build. Le bloc navy de sidebar, lui, était déjà universel sur
      // les 4 apps depuis F-048.
      brand
      // "KEYIMMO", pas "Back-office" : évite la redite avec le libellé
      // d'onglet de navigation déjà présent dans la même sidebar.
      appLabel="KEYIMMO"
      modules={MODULES}
      userRoles={userRoles}
      activeModuleId={activeTab}
      breadcrumbs={[{ label: TABS.find((tab) => tab.id === activeTab)!.label }]}
      taskInboxCount={taskInboxState.status === 'success' ? taskInboxState.data.length : 0}
      // Ticket F-061 — bascule vers le nouvel onglet « Tâches » (même
      // endpoint que le compteur ci-dessus), URL synchronisée comme
      // n'importe quel autre onglet (`useUrlSyncedTab`) : jamais une
      // navigation `<a href>` classique, qui aurait rechargé toute la page.
      onTaskInboxClick={() => setActiveTab('tasks')}
    >
      <TabBar tabs={TABS} activeTabId={activeTab} onChange={(id) => setActiveTab(id as AuthenticatedTabId)} aria-label="Sections back-office" />

      {activeTab === 'backoffice' && <BackofficeView />}
      {activeTab === 'devis' && <DevisView />}
      {activeTab === 'pricing' && <PricingView />}
      {activeTab === 'legal-tiers' && <LegalPaymentTiersView />}
      {activeTab === 'programs' && <ProgramsView />}
      {activeTab === 'program-requests' && <ProgramRequestsView />}
      {activeTab === 'tasks' && <TasksView />}
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
function LoginView({ redirect }: { redirect: (url: string) => void }) {
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
      const { access, refresh } = await api.login(email, password);
      const me = await api.getMe(access);
      const targetApp = resolveRedirectApp(me);
      const origins = resolveAppOrigins();
      redirect(buildRedirectUrl(origins[targetApp], access, refresh));
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
    <main style={{ display: 'flex', minHeight: '100vh' }}>
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
          <span style={{ fontFamily: typography.headingFontFamily, fontWeight: 600, fontSize: '18px' }}>KEYA</span>
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
              (« Connexion à KEYA », dans le formulaire ci-dessous) reste
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
            Chaque preuve, chaque validation — tracées et vérifiables, du premier coup de pelle à la remise des clés.
          </p>
        </div>

        <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', position: 'relative' }}>
          Plateforme réservée aux organisations partenaires KEYA.
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
          <h1 style={{ marginBottom: '4px' }}>Connexion à KEYA</h1>

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
        </form>
      </div>
    </main>
  );
}
