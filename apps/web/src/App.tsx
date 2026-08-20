import { useState } from 'react';

import {
  AlertBanner, AppShell, TabBar, type AppModule,
} from '@keya/design-system';

import { useApiClient } from './api/ApiClientContext';
import { ApiError } from './api/client';
import { useApiResource } from './api/useApiResource';
import { deriveAllRoleCodes, hasAdminKeyimmoAccess } from './auth/adminAccess';
import {
  buildRedirectUrl, isSameOriginRedirect, resolveAppOrigins, resolveRedirectApp,
} from './auth/redirectTarget';
import { BackofficeView } from './views/BackofficeView';
import { DevisView } from './views/DevisView';
import { LegalPaymentTiersView } from './views/LegalPaymentTiersView';
import { PricingView } from './views/PricingView';

// Ticket 021 — réservé à admin_keyimmo, `requiredRoles` reste posé malgré la
// garde déjà faite dans `AuthenticatedApp` (ci-dessous) — défense en
// profondeur, même discipline que RLS + filtre applicatif ailleurs dans ce
// projet (CLAUDE.md). Ticket 025 — un second module apparaît
// (« Devis / Appels d'offres ») : apps/web n'héberge plus un seul écran
// depuis ce ticket, sur le MÊME schéma d'onglets déjà établi pour HOME/BUILD
// (`TabBar`, voir ci-dessous) plutôt qu'un mécanisme parallèle. Ticket
// F-028 — un troisième module (« Tarifs ») suit le même schéma. Ticket
// F-030 — un quatrième module (« Paliers légaux ») suit le même schéma.
const MODULES: AppModule[] = [
  { id: 'backoffice', label: 'Back-office', href: '/', requiredRoles: ['admin_keyimmo'] },
  { id: 'devis', label: 'Devis / Appels d\'offres', href: '/devis', requiredRoles: ['admin_keyimmo'] },
  { id: 'pricing', label: 'Tarifs', href: '/tarifs', requiredRoles: ['admin_keyimmo'] },
  { id: 'legal-tiers', label: 'Paliers légaux', href: '/paliers-legaux', requiredRoles: ['admin_keyimmo'] },
];

type AuthenticatedTabId = 'backoffice' | 'devis' | 'pricing' | 'legal-tiers';

const TABS: { id: AuthenticatedTabId; label: string }[] = [
  { id: 'backoffice', label: 'Back-office' },
  { id: 'devis', label: 'Devis / Appels d\'offres' },
  { id: 'pricing', label: 'Tarifs' },
  { id: 'legal-tiers', label: 'Paliers légaux' },
];

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

  if (storedAccessToken) {
    return <AuthenticatedApp />;
  }

  return <LoginView redirect={redirect} />;
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
        <AlertBanner title="Impossible de charger votre profil." />
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
 */
function AuthenticatedTabs({ userRoles }: { userRoles: string[] }) {
  const [activeTab, setActiveTab] = useState<AuthenticatedTabId>('backoffice');

  return (
    <AppShell
      density="dense"
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
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        <label>
          Mot de passe
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        <button type="submit" disabled={submitting}>
          {submitting ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
    </main>
  );
}
