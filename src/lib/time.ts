import type { DueInput } from '@raphasparda/ronin-shared';

/**
 * Prazo e fuso do workspace (overview.md §4.3, ADR 0011), sem dependências: usa `Intl`.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Deslocamento do fuso (ms, local − UTC) no instante `utcMs`. */
export function timeZoneOffsetMs(timeZone: string, utcMs: number): number {
  const parts = formatterFor(timeZone).formatToParts(new Date(utcMs));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  // Segundos inteiros: descarta os milissegundos do instante para comparar só o deslocamento.
  return asUtc - (utcMs - (((utcMs % 1000) + 1000) % 1000));
}

/**
 * Converte data/hora de parede no fuso para o instante UTC. Hora inexistente (início de horário
 * de verão) cai no instante equivalente depois do salto; hora ambígua usa a primeira ocorrência.
 */
export function zonedWallTimeToUtc(
  timeZone: string,
  wall: { year: number; month: number; day: number; hour: number; minute: number; ms: number },
): Date {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, 0, wall.ms);
  const firstOffset = timeZoneOffsetMs(timeZone, naive);
  let utc = naive - firstOffset;
  const secondOffset = timeZoneOffsetMs(timeZone, utc);
  if (secondOffset !== firstOffset) {
    const candidate = naive - secondOffset;
    if (timeZoneOffsetMs(timeZone, candidate) === secondOffset) utc = candidate;
  }
  return new Date(utc);
}

/** Último milissegundo do dia (prazo sem hora). */
const END_OF_DAY_MS = 59 * 1000 + 999;

/**
 * `DueInput` (no fuso do workspace) → `{ dueAt, dueHasTime }`. Sem hora: `23:59:59.999` do dia.
 * O formato já foi validado pelo schema (`YYYY-MM-DD`, `HH:mm`).
 */
export function dueInputToUtc(
  due: DueInput,
  timeZone: string,
): { dueAt: Date; dueHasTime: boolean } {
  const [year, month, day] = due.date.split('-').map(Number) as [number, number, number];
  if (due.time === null) {
    return {
      dueAt: zonedWallTimeToUtc(timeZone, {
        year,
        month,
        day,
        hour: 23,
        minute: 59,
        ms: END_OF_DAY_MS,
      }),
      dueHasTime: false,
    };
  }
  const [hour, minute] = due.time.split(':').map(Number) as [number, number];
  return {
    dueAt: zonedWallTimeToUtc(timeZone, { year, month, day, hour, minute, ms: 0 }),
    dueHasTime: true,
  };
}
