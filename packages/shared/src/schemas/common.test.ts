import { describe, expect, it } from 'vitest';

import {
  cardPrioritySchema,
  dueInputSchema,
  emailSchema,
  isoDateTimeSchema,
  paletteColorSchema,
  passwordSchema,
  placementSchema,
  uuidSchema,
} from './common';

const UUID = '3f1c2b1e-8a4d-4c3b-9f2e-1a2b3c4d5e6f';

describe('uuidSchema', () => {
  it('aceita UUID v4 e rejeita lixo', () => {
    expect(uuidSchema.safeParse(UUID).success).toBe(true);
    expect(uuidSchema.safeParse('123').success).toBe(false);
    expect(uuidSchema.safeParse('').success).toBe(false);
  });
});

describe('isoDateTimeSchema', () => {
  it('aceita ISO UTC com Z e rejeita offset ou só data', () => {
    expect(isoDateTimeSchema.safeParse('2026-09-16T14:03:00.000Z').success).toBe(true);
    expect(isoDateTimeSchema.safeParse('2026-09-16T14:03:00-03:00').success).toBe(false);
    expect(isoDateTimeSchema.safeParse('2026-09-16').success).toBe(false);
  });
});

describe('placementSchema', () => {
  it('aceita start, end e after com id', () => {
    expect(placementSchema.parse({ type: 'start' })).toEqual({ type: 'start' });
    expect(placementSchema.parse({ type: 'end' })).toEqual({ type: 'end' });
    expect(placementSchema.parse({ type: 'after', id: UUID })).toEqual({ type: 'after', id: UUID });
  });

  it('rejeita after sem id válido e tipo desconhecido', () => {
    expect(placementSchema.safeParse({ type: 'after' }).success).toBe(false);
    expect(placementSchema.safeParse({ type: 'after', id: 'x' }).success).toBe(false);
    expect(placementSchema.safeParse({ type: 'before', id: UUID }).success).toBe(false);
  });

  it('descarta campos extras', () => {
    expect(placementSchema.parse({ type: 'end', id: UUID })).toEqual({ type: 'end' });
  });
});

describe('dueInputSchema', () => {
  it('aceita data com hora HH:mm e data sem hora', () => {
    expect(dueInputSchema.safeParse({ date: '2026-09-20', time: '09:30' }).success).toBe(true);
    expect(dueInputSchema.safeParse({ date: '2026-09-20', time: '23:59' }).success).toBe(true);
    expect(dueInputSchema.safeParse({ date: '2028-02-29', time: null }).success).toBe(true);
  });

  it('rejeita data inexistente, formato errado e hora fora de HH:mm', () => {
    expect(dueInputSchema.safeParse({ date: '2026-02-30', time: null }).success).toBe(false);
    expect(dueInputSchema.safeParse({ date: '20/09/2026', time: null }).success).toBe(false);
    expect(dueInputSchema.safeParse({ date: '2026-09-20', time: '24:00' }).success).toBe(false);
    expect(dueInputSchema.safeParse({ date: '2026-09-20', time: '9:30' }).success).toBe(false);
    expect(dueInputSchema.safeParse({ date: '2026-09-20', time: '09:30:00' }).success).toBe(false);
    expect(dueInputSchema.safeParse({ date: '2026-09-20' }).success).toBe(false);
  });
});

describe('emailSchema', () => {
  it('normaliza com trim e minúsculas', () => {
    expect(emailSchema.parse('  Ana.Souza@Exemplo.COM ')).toBe('ana.souza@exemplo.com');
  });

  it('rejeita vazio, inválido e acima de 254 caracteres', () => {
    expect(emailSchema.safeParse('   ').success).toBe(false);
    expect(emailSchema.safeParse('ana@').success).toBe(false);
    const long = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(58)}.com`;
    expect(long.length).toBe(255);
    const result = emailSchema.safeParse(long);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('E-mail muito longo');
  });

  it('mensagem de erro em pt-BR', () => {
    expect(emailSchema.safeParse('nao-e-email').error?.issues[0]?.message).toBe('E-mail inválido');
  });
});

describe('passwordSchema', () => {
  it('aceita de 10 a 256 caracteres, sem trim', () => {
    expect(passwordSchema.safeParse('a'.repeat(10)).success).toBe(true);
    expect(passwordSchema.safeParse('a'.repeat(256)).success).toBe(true);
    expect(passwordSchema.parse('  senha12  ')).toBe('  senha12  ');
  });

  it('rejeita menos de 10 e mais de 256', () => {
    expect(passwordSchema.safeParse('a'.repeat(9)).success).toBe(false);
    expect(passwordSchema.safeParse('a'.repeat(257)).success).toBe(false);
  });
});

describe('enums', () => {
  it('paletteColorSchema aceita só chaves da paleta', () => {
    expect(paletteColorSchema.safeParse('magenta').success).toBe(true);
    expect(paletteColorSchema.safeParse('#ff0000').success).toBe(false);
    expect(paletteColorSchema.safeParse('pink').success).toBe(false);
  });

  it('cardPrioritySchema aceita só os 4 níveis', () => {
    for (const p of ['low', 'medium', 'high', 'urgent']) {
      expect(cardPrioritySchema.safeParse(p).success).toBe(true);
    }
    expect(cardPrioritySchema.safeParse('none').success).toBe(false);
    expect(cardPrioritySchema.safeParse(null).success).toBe(false);
  });
});
