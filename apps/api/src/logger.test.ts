import { Writable } from 'node:stream';

import { pino } from 'pino';
import { describe, expect, it } from 'vitest';

import { buildLoggerOptions } from './logger';

function capture(): { stream: Writable; lines: () => Record<string, unknown>[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return {
    stream,
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

describe('logger', () => {
  it('usa o nível do env', () => {
    expect(buildLoggerOptions({ LOG_LEVEL: 'warn' }).level).toBe('warn');
  });

  it('redige cookie, set-cookie, senhas e tokens', () => {
    const { redact } = buildLoggerOptions({ LOG_LEVEL: 'info' });
    const { stream, lines } = capture();
    const log = pino({ level: 'info', redact }, stream);

    log.info({
      req: { headers: { cookie: 'kanban_sid=abc', authorization: 'Bearer x', host: 'h' } },
      res: { headers: { 'set-cookie': 'kanban_sid=abc' } },
      body: { password: 'p1', currentPassword: 'p2', newPassword: 'p3', token: 't', name: 'Ana' },
    });

    const [entry] = lines();
    const text = JSON.stringify(entry);
    for (const secret of ['kanban_sid=abc', 'Bearer x', '"p1"', '"p2"', '"p3"', '"t"']) {
      expect(text).not.toContain(secret);
    }
    expect(entry).toMatchObject({
      req: { headers: { cookie: '[REDACTED]', authorization: '[REDACTED]', host: 'h' } },
      res: { headers: { 'set-cookie': '[REDACTED]' } },
      body: {
        password: '[REDACTED]',
        currentPassword: '[REDACTED]',
        newPassword: '[REDACTED]',
        token: '[REDACTED]',
        name: 'Ana',
      },
    });
  });
});
