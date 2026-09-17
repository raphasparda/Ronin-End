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

// ---------------------------------------------------------------------------
// Utilitários de contrato (Fatias 2 a 9)
// ---------------------------------------------------------------------------

/**
 * Token de convite/redefinição: 43 caracteres base64url (32 bytes), sem `trim`.
 * Token malformado → 400 VALIDATION_ERROR; bem formado mas inexistente/usado → 410 TOKEN_INVALID.
 */
export const tokenSchema = z
  .string({ error: 'Token inválido' })
  .regex(/^[A-Za-z0-9_-]{43}$/, { error: 'Token inválido' });

export const PASSWORD_SAME_AS_EMAIL_MESSAGE = 'A senha não pode ser igual ao e-mail';

/**
 * `true` se a senha, ignorando espaços nas pontas e caixa, é igual ao e-mail (overview.md §6.1).
 * Usado nos schemas que têm os dois campos e no servidor quando o e-mail não vem no corpo
 * (redefinição por link e troca de senha).
 */
export function isPasswordSameAsEmail(password: string, email: string): boolean {
  return password.trim().toLowerCase() === email.trim().toLowerCase();
}

interface TextFieldOptions {
  min: number;
  max: number;
  /** Mensagem para ausente/vazio. */
  required: string;
  /** Mensagem para acima do máximo. */
  tooLong: string;
}

/** Texto de entrada com `trim` e limites aplicados após o trim (api.md §1). */
export function textFieldSchema({ min, max, required, tooLong }: TextFieldOptions) {
  return z
    .string({ error: required })
    .trim()
    .min(min, { error: required })
    .max(max, { error: tooLong });
}

export const AT_LEAST_ONE_FIELD_MESSAGE = 'Informe ao menos um campo para alterar';

/** `true` se algum campo declarado veio preenchido (PATCH "ao menos um"). */
export function hasAtLeastOneField(body: Record<string, unknown>): boolean {
  return Object.values(body).some((value) => value !== undefined);
}

/** Query string booleana estrita (`true` | `false`), com padrão. */
export function booleanQuerySchema(defaultValue: boolean) {
  return z
    .enum(['true', 'false'], { error: 'Use true ou false' })
    .default(defaultValue ? 'true' : 'false')
    .transform((value) => value === 'true');
}

export type Uuid = z.infer<typeof uuidSchema>;
export type IsoDateTime = z.infer<typeof isoDateTimeSchema>;
export type Role = z.infer<typeof roleSchema>;
export type UserStatus = z.infer<typeof userStatusSchema>;
export type Placement = z.infer<typeof placementSchema>;
export type DueInput = z.infer<typeof dueInputSchema>;
