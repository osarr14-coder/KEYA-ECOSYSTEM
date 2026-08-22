import { useState } from 'react';

import {
  AlertBanner, ApiErrorBanner, AppShell, Button, Input, TabBar, useOnlineStatus, type AppModule, type IconName,
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

type AuthenticatedTabId = 'backoffice' | 'devis' | 'pricing' | 'legal-tiers';

/**
 * Source UNIQUE id/label/chemin des 4 onglets admin — ticket F-031 :
 * `MODULES` (sidebar `AppShell`) et `TABS` (`TabBar`) en étaient deux copies
 * manuellement synchronisées depuis le ticket F-030 (id/label dupliqués,
 * jamais le chemin pour `TabBar`, qui ne connaissait pas encore l'URL avant
 * ce ticket) — dérivés ci-dessous plutôt que dupliqués une troisième fois.
 * `path` alimente aussi `TAB_ROUTES` (`useUrlSyncedTab`, ci-dessous) :
 * réservé à admin_keyimmo (`requiredRoles`), défense en profondeur en plus
 * de la garde déjà faite dans `AuthenticatedApp`, même discipline que RLS +
 * filtre applicatif ailleurs dans ce projet (CLAUDE.md).
 */
const TAB_DEFINITIONS: { id: AuthenticatedTabId; label: string; path: string; icon: IconName }[] = [
  { id: 'backoffice', label: 'Back-office', path: '/', icon: 'shield-check' },
  { id: 'devis', label: 'Devis / Appels d\'offres', path: '/devis', icon: 'file-text' },
  { id: 'pricing', label: 'Tarifs', path: '/tarifs', icon: 'wallet' },
  { id: 'legal-tiers', label: 'Paliers légaux', path: '/paliers-legaux', icon: 'scale' },
];

const MODULES: AppModule[] = TAB_DEFINITIONS.map(({
  id, label, path, icon,
}) => ({
  id, label, href: path, requiredRoles: ['admin_keyimmo'], icon,
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
  const [activeTab, setActiveTab] = useUrlSyncedTab(TAB_ROUTES, 'backoffice');

  return (
    <AppShell
      density="dense"
      // Ticket F-048 — révision LIMITÉE de la doctrine 17.3 : le bloc navy
      // de sidebar (AppShell, toujours rendu) est universel sur les 4
      // apps ; `brand` (bandeau <header>) reste HOME-only, non activé ici.
      // "KEYIMMO", pas "Back-office" : évite la redite avec le libellé
      // d'onglet de navigation déjà présent dans la même sidebar.
      appLabel="KEYIMMO"
      modules={MODULES}
      userRoles={userRoles}
      activeModuleId={activeTab}
      breadcrumbs={[{ label: TABS.find((tab) => tab.id === activeTab)!.label }]}
    >
      <TabBar tabs={TABS} activeTabId={activeTab} onChange={(id) => setActiveTab(id as AuthenticatedTabId)} aria-label="Sections back-office" />

      {activeTab === 'backoffice' && <BackofficeView />}
      {activeTab === 'devis' && <DevisView />}
      {activeTab === 'pricing' && <PricingView />}
      {activeTab === 'legal-tiers' && <LegalPaymentTiersView />}
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

  return (
    <main
      style={{
        display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <form
        onSubmit={(event) => { void handleSubmit(event); }}
        aria-label="Connexion"
        style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '320px' }}
      >
        <h1>KEYA — Connexion</h1>

        {error && <AlertBanner title={error} />}

        <label>
          Email
          <Input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        <label>
          Mot de passe
          <Input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        <Button type="submit" disabled={submitting}>
          {submitting ? 'Connexion…' : 'Se connecter'}
        </Button>
      </form>
    </main>
  );
}
