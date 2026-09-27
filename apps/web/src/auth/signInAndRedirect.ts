import type { ApiClient } from '../api/client';
import { buildRedirectUrl, resolveAppOrigins, resolveRedirectApp } from './redirectTarget';

/**
 * Ticket F-079 — connexion puis redirection vers l'app du RÔLE réel
 * (ticket 020), partagée par l'écran de connexion et l'inscription d'un
 * acquéreur (qui se connecte dans la foulée).
 */
export async function signInAndRedirect(
  api: Pick<ApiClient, 'login' | 'getMe'>,
  email: string,
  password: string,
  redirect: (url: string) => void,
) {
  const { access, refresh } = await api.login(email, password);
  const me = await api.getMe(access);
  const targetApp = resolveRedirectApp(me);
  redirect(buildRedirectUrl(resolveAppOrigins()[targetApp], access, refresh));
}
