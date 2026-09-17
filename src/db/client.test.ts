import pg from 'pg';
import { describe, expect, it } from 'vitest';

/** `ssl` que o `pg` monta a partir da URL (campo interno, sem tipo público). */
function sslFromUrl(connectionString: string): unknown {
  const client = new pg.Client({ connectionString }) as unknown as {
    connectionParameters: { ssl: unknown };
  };
  return client.connectionParameters.ssl;
}

/**
 * Neon exige TLS (`?sslmode=require` na `DATABASE_URL`, docs/ops/deploy-render.md). O pool não
 * recebe opção `ssl` própria: o `pg` monta a partir da URL. Estes testes travam que `require`
 * continua verificando o certificado (nada de `rejectUnauthorized: false`).
 */
describe('TLS a partir da DATABASE_URL', () => {
  const neon = 'postgresql://ronin:segredo@ep-exemplo.us-east-1.aws.neon.tech/neondb';

  it.each(['sslmode=require', 'sslmode=verify-full', 'sslmode=require&channel_binding=require'])(
    '%s liga TLS com verificação do certificado',
    (query) => {
      const ssl = sslFromUrl(`${neon}?${query}`);
      expect(ssl).toBeTruthy();
      expect(ssl).not.toMatchObject({ rejectUnauthorized: false });
    },
  );

  it('sem sslmode (dev local) não liga TLS', () => {
    expect(sslFromUrl('postgres://kanban:kanban@127.0.0.1:5433/kanban')).toBeFalsy();
  });
});
