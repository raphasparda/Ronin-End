import { z } from 'zod';

import {
  DEFAULT_TIMEZONE,
  emailSchema,
  isoDateTimeSchema,
  isPasswordSameAsEmail,
  PASSWORD_SAME_AS_EMAIL_MESSAGE,
  passwordSchema,
  roleSchema,
  timezoneSchema,
  tokenSchema,
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
  .refine((body) => !isPasswordSameAsEmail(body.password, body.email), {
    error: PASSWORD_SAME_AS_EMAIL_MESSAGE,
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

// ---------------------------------------------------------------------------
// Convites e redefinição de senha: rotas públicas (api.md §5, Fatia 2)
// ---------------------------------------------------------------------------

/** Corpo `{ token }` dos lookups de convite e de redefinição. */
export const tokenLookupRequestSchema = z.object({
  token: tokenSchema,
});

/** `POST /api/auth/invites/lookup` (corpo). */
export const inviteLookupRequestSchema = tokenLookupRequestSchema;

/** `POST /api/auth/invites/lookup` → 200. `email` nulo = convite sem e-mail fixo. */
export const inviteLookupResponseSchema = z.object({
  email: z.string().nullable(),
  role: roleSchema,
  expiresAt: isoDateTimeSchema,
});

/**
 * `POST /api/auth/invites/accept` (corpo). Mesmas regras de e-mail e senha do setup.
 * E-mail diferente do fixado no convite → 409 `INVITE_EMAIL_MISMATCH` (checado no servidor).
 */
export const acceptInviteRequestSchema = z
  .object({
    token: tokenSchema,
    name: userNameSchema,
    email: emailSchema,
    password: passwordSchema,
  })
  .refine((body) => !isPasswordSameAsEmail(body.password, body.email), {
    error: PASSWORD_SAME_AS_EMAIL_MESSAGE,
    path: ['password'],
  });

/** `POST /api/auth/invites/accept` → 201 (+ Set-Cookie). */
export const acceptInviteResponseSchema = authSessionResponseSchema;

/** `POST /api/auth/password-resets/lookup` (corpo). */
export const passwordResetLookupRequestSchema = tokenLookupRequestSchema;

/** `POST /api/auth/password-resets/lookup` → 200. */
export const passwordResetLookupResponseSchema = z.object({
  userName: z.string(),
  expiresAt: isoDateTimeSchema,
});

/**
 * `POST /api/auth/password-resets/complete` (corpo) → 204.
 * O e-mail do alvo não vem no corpo: o servidor recusa senha igual ao e-mail com
 * `isPasswordSameAsEmail` → 400 `VALIDATION_ERROR` em `password`.
 */
export const completePasswordResetRequestSchema = z.object({
  token: tokenSchema,
  password: passwordSchema,
});

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
export type TokenLookupRequest = z.infer<typeof tokenLookupRequestSchema>;
export type InviteLookupRequest = z.infer<typeof inviteLookupRequestSchema>;
export type InviteLookupResponse = z.infer<typeof inviteLookupResponseSchema>;
export type AcceptInviteRequest = z.infer<typeof acceptInviteRequestSchema>;
export type AcceptInviteResponse = z.infer<typeof acceptInviteResponseSchema>;
export type PasswordResetLookupRequest = z.infer<typeof passwordResetLookupRequestSchema>;
export type PasswordResetLookupResponse = z.infer<typeof passwordResetLookupResponseSchema>;
export type CompletePasswordResetRequest = z.infer<typeof completePasswordResetRequestSchema>;
