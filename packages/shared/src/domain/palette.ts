/**
 * Paleta fixa de cores de listas e etiquetas (ADR 0012).
 * A ordem é a mesma do enum `palette_color` no banco e define o ciclo de `nextPaletteColor`.
 */
export const PALETTE = [
  'gray',
  'red',
  'orange',
  'yellow',
  'green',
  'cyan',
  'blue',
  'purple',
  'magenta',
] as const;

export type PaletteColor = (typeof PALETTE)[number];

/** Nome acessível de cada cor (pt-BR), para amostras e leitores de tela. */
export const PALETTE_LABELS = {
  gray: 'Cinza',
  red: 'Vermelho',
  orange: 'Laranja',
  yellow: 'Amarelo',
  green: 'Verde',
  cyan: 'Ciano',
  blue: 'Azul',
  purple: 'Roxo',
  magenta: 'Magenta',
} as const satisfies Record<PaletteColor, string>;

/** Cores das listas padrão de um quadro novo: "A fazer", "Fazendo", "Concluído". */
export const DEFAULT_BOARD_LIST_COLORS = [
  'blue',
  'orange',
  'green',
] as const satisfies readonly PaletteColor[];

/**
 * Cor de uma lista nova sem cor informada: a próxima da paleta depois da cor da
 * última lista ativa (cíclico). Sem listas ativas (`null`) → primeira cor.
 */
export function nextPaletteColor(lastColor: PaletteColor | null): PaletteColor {
  // indexOf -1 (null ou valor fora da paleta vindo de código não tipado) cai na primeira cor.
  const index = lastColor === null ? -1 : PALETTE.indexOf(lastColor);
  return PALETTE[(index + 1) % PALETTE.length] as PaletteColor;
}
