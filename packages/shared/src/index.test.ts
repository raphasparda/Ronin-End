import { describe, expect, it } from 'vitest';

import * as shared from './index';

describe('@kanban/shared (barrel)', () => {
  it('exporta a API pública (tarefas 0.3 e 1.1)', () => {
    for (const name of [
      'ERROR_CODES',
      'errorResponseSchema',
      'uuidSchema',
      'isoDateTimeSchema',
      'placementSchema',
      'dueInputSchema',
      'emailSchema',
      'passwordSchema',
      'paletteColorSchema',
      'cardPrioritySchema',
      'getDueState',
      'PALETTE',
      'nextPaletteColor',
      'PRIORITY_RANK',
      'comparePriority',
      'PRIORITY_LABELS',
      'userNameSchema',
      'workspaceNameSchema',
      'timezoneSchema',
      'isSupportedTimeZone',
      'DEFAULT_TIMEZONE',
      'sessionUserSchema',
      'workspaceSchema',
      'authSessionResponseSchema',
      'setupStatusResponseSchema',
      'setupRequestSchema',
      'setupResponseSchema',
      'loginPasswordSchema',
      'loginRequestSchema',
      'loginResponseSchema',
      'meResponseSchema',
      'healthResponseSchema',
    ]) {
      expect(shared, name).toHaveProperty(name);
    }
  });
});
