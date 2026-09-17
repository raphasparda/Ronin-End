import { getTableConfig, pgTable } from 'drizzle-orm/pg-core';
import { afterAll, expect, it } from 'vitest';

import { closeTestDb, describeDb, getTestPool } from '../../test/db';

import { textC } from './types';

const probe = pgTable('probe', { position: textC('position').notNull() });
const positionType = getTableConfig(probe).columns[0]?.getSQLType();

it('textC gera o DDL text COLLATE "C"', () => {
  expect(positionType).toBe('text COLLATE "C"');
});

describeDb('textC no PostgreSQL', () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it('ordena byte a byte, como as chaves de fractional-indexing esperam', async () => {
    const client = await getTestPool().connect();
    try {
      await client.query('BEGIN');
      // DDL vindo do próprio customType (o cluster de CI usa colação en_US, onde a ordem seria outra).
      await client.query(
        `CREATE TEMP TABLE t_textc (position ${positionType ?? ''}) ON COMMIT DROP`,
      );
      await client.query(`INSERT INTO t_textc VALUES ('a'), ('Zz'), ('a0'), ('B')`);
      const { rows } = await client.query<{ position: string }>(
        'SELECT position FROM t_textc ORDER BY position',
      );
      expect(rows.map((r) => r.position)).toEqual(['B', 'Zz', 'a', 'a0']);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });
});
