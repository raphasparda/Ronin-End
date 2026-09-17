import { z } from 'zod';

import {
  DEFAULT_TIMEZONE,
  emailSchema,
  passwordSchema,
  roleSchema,
  timezoneSchema,
  userNameSchema,
  uuidSchema,
  workspaceNameSchema,
} from './common';

// ---------------------------------------------------------------------------
// Tipos de saída (api.md §2)
// ---------------------------------------------------------------------------

/** Usuário da sessão. Único formato de usuário que inclui e-mail fora da administração. */
export const sessionUserSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  email: z.string(),
  role: roleSchema,
});

export const workspaceSchema = z.object({
  name: z.string(),
  timezone: z.string(),
});

/** `{ user, workspace }`: resposta de setup, login e `auth/me`. */
export const authSessionResponseSchema = z.object({
  user: sessionUserSchema,
  workspace: workspaceSchema,
});

// ---------------------------------------------------------------------------
// Setup (api.md §4)
// ---------------------------------------------------------------------------

/** `GET /api/setup/status` → 200. */
export const setupStatusResponseSchema = z.object({
  needsSetup: z.boolean(),
});

/**
 * `POST /api/setup` (corpo). `timezone` é opcional e vira `America/Sao_Paulo`.
 * A senha não pode ser igual ao e-mail (overview.md §6.1).
 */
export const setupRequestSchema = z
  .object({
    workspaceName: workspaceNameSchema,
    timezone: timezoneSchema.default(DEFAULT_TIMEZONE),
    name: userNameSchema,
    email: emailSchema,
    password: passwordSchema,
  })
  .refine((body) => body.password.trim().toLowerCase() !== body.email, {
    error: 'A senha não pode ser igual ao e-mail',
    path: ['password'],
  });

/** `POST /api/setup` → 201. */
export const setupResponseSchema = authSessionResponseSchema;

// ---------------------------------------------------------------------------
// Autenticação (api.md §5)
// ---------------------------------------------------------------------------

/** Senha no login: 1 a 256 caracteres, sem `trim` (não revela a política de cadastro). */
export const loginPasswordSchema = z
  .string({ error: 'Senha obrigatória' })
  .min(1, { error: 'Senha obrigatória' })
  .max(256, { error: 'A senha pode ter no máximo 256 caracteres' });

/** `POST /api/auth/login` (corpo). */
export const loginRequestSchema = z.object({
  email: emailSchema,
  password: loginPasswordSchema,
});

/** `POST /api/auth/login` → 200 (+ Set-Cookie). */
export const loginResponseSchema = authSessionResponseSchema;

/** `GET /api/auth/me` → 200. */
export const meResponseSchema = authSessionResponseSchema;

// `POST /api/auth/logout` → 204 sem corpo: não há schema de resposta.

export type SessionUser = z.infer<typeof sessionUserSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;
export type SetupStatusResponse = z.infer<typeof setupStatusResponseSchema>;
/** Corpo do setup como o cliente envia (`timezone` opcional). */
export type SetupRequestInput = z.input<typeof setupRequestSchema>;
/** Corpo do setup após validação (`timezone` preenchido). */
export type SetupRequest = z.output<typeof setupRequestSchema>;
export type SetupResponse = z.infer<typeof setupResponseSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
