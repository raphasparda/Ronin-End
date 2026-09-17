import type { Features } from '@raphasparda/ronin-shared';

import type { App } from '../app';

/**
 * Recursos ligados nesta instância (api.md §2, Fatia 11). Dependem de configuração, não de papel,
 * e vão nas respostas de sessão (setup, login, aceite de convite e `auth/me`), que é o que a SPA
 * lê no boot (api.md §18.7 item 57).
 *
 * `cardCovers`: capa do card, ligada só quando o R2 está configurado (ADR 0016, overview.md §6.9).
 */
export function appFeatures(app: Pick<App, 'coverStorage'>): Features {
  return { cardCovers: app.coverStorage !== null };
}
