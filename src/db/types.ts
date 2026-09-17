import { customType, timestamp } from 'drizzle-orm/pg-core';

/**
 * `text COLLATE "C"`: comparação byte a byte, obrigatória para as chaves de `fractional-indexing`
 * (ADR 0004). Com a colação padrão, `'Zz' < 'a'` pode ser falso e a ordem quebra.
 * Use em toda coluna `position`. No JS, compare com `<`/`>`, nunca `localeCompare`.
 */
export const textC = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'text COLLATE "C"';
  },
});

/** `timestamptz NOT NULL DEFAULT now()`. */
export const createdAt = () =>
  timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();

/** `timestamptz NOT NULL DEFAULT now()`, atualizado pelo Drizzle em todo `update()`. */
export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
