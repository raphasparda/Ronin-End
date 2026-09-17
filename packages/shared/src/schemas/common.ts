import { z } from 'zod';

import { CARD_STATUSES } from '../domain/due-state';
import { PALETTE } from '../domain/palette';
import { CARD_PRIORITIES } from '../domain/priority';

/** UUID (RFC 9562). Parâmetro inválido → 400 VALIDATION_ERROR. */
export const uuidSchema = z.uuid({ error: 'Identificador inválido' });

/** Data/hora ISO 8601 em UTC com `Z` (ex.: `2026-09-16T14:03:00.000Z`). */
export const isoDateTimeSchema = z.iso.datetime({ error: 'Data/hora inválida' });

export const roleSchema = z.enum(['admin', 'member']);
export const userStatusSchema = z.enum(['active', 'deactivated']);
export const cardStatusSchema = z.enum(CARD_STATUSES);
export const paletteColorSchema = z.enum(PALETTE, { error: 'Cor inválida' });
export const cardPrioritySchema = z.enum(CARD_PRIORITIES, { error: 'Prioridade inválida' });

/** Posição relativa entre irmãos ativos do destino (api.md §2). */
export const placementSchema = z.discriminatedUnion(
  'type',
  [
    z.object({ type: z.literal('start') }),
    z.object({ type: z.literal('end') }),
    z.object({ type: z.literal('after'), id: uuidSchema }),
  ],
  { error: 'Posição inválida' },
);

/** Prazo na entrada, no fuso do workspace: `YYYY-MM-DD` + `HH:mm` (24h) ou `null`. */
export const dueInputSchema = z.object({
  date: z.iso.date({ error: 'Data inválida (use AAAA-MM-DD)' }),
  time: z.iso.time({ precision: -1, error: 'Hora inválida (use HH:mm)' }).nullable(),
});

/** E-mail normalizado (`trim` + minúsculas), até 254 caracteres. */
export const emailSchema = z
  .string({ error: 'E-mail obrigatório' })
  .trim()
  .toLowerCase()
  .min(1, { error: 'E-mail obrigatório' })
  .max(254, { error: 'E-mail muito longo' })
  .check(z.email({ error: 'E-mail inválido' }));

/** Senha: 10 a 256 caracteres, sem `trim`. */
export const passwordSchema = z
  .string({ error: 'Senha obrigatória' })
  .min(10, { error: 'A senha precisa ter pelo menos 10 caracteres' })
  .max(256, { error: 'A senha pode ter no máximo 256 caracteres' });

/** Nome de usuário: 1 a 80 caracteres após `trim`. */
export const userNameSchema = z
  .string({ error: 'Nome obrigatório' })
  .trim()
  .min(1, { error: 'Nome obrigatório' })
  .max(80, { error: 'O nome pode ter no máximo 80 caracteres' });

/** Nome do workspace: 1 a 100 caracteres após `trim`. */
export const workspaceNameSchema = z
  .string({ error: 'Nome do workspace obrigatório' })
  .trim()
  .min(1, { error: 'Nome do workspace obrigatório' })
  .max(100, { error: 'O nome do workspace pode ter no máximo 100 caracteres' });

/** Fuso padrão do workspace quando o setup não informa (api.md §4). */
export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

let supportedTimeZones: ReadonlySet<string> | undefined;

/** `true` se o fuso está em `Intl.supportedValuesOf('timeZone')` (api.md §2). */
export function isSupportedTimeZone(value: string): boolean {
  supportedTimeZones ??= new Set(Intl.supportedValuesOf('timeZone'));
  return supportedTimeZones.has(value);
}

/** Fuso IANA aceito pelo runtime (ex.: `America/Sao_Paulo`). */
export const timezoneSchema = z
  .string({ error: 'Fuso horário obrigatório' })
  .trim()
  .refine(isSupportedTimeZone, { error: 'Fuso horário inválido' });

export type Uuid = z.infer<typeof uuidSchema>;
export type IsoDateTime = z.infer<typeof isoDateTimeSchema>;
export type Role = z.infer<typeof roleSchema>;
export type UserStatus = z.infer<typeof userStatusSchema>;
export type Placement = z.infer<typeof placementSchema>;
export type DueInput = z.infer<typeof dueInputSchema>;
