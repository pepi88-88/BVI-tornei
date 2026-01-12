// src/lib/groupColors.ts
export const GROUP_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export const GROUP_COLOR_LIST: string[] = [
  '#2563EB', // A  blue-600
  '#EF4444', // B  red-500
  '#F59E0B', // C  amber-500
  '#A855F7', // D  purple-500
  '#10B981', // E  emerald-500
  '#FB923C', // F  orange-400
  '#06B6D4', // G  cyan-500
  '#8B5CF6', // H  violet-500
  '#22C55E', // I  green-500
  '#F97316', // J  orange-500
  '#0EA5E9', // K  sky-500
  '#EAB308', // L  yellow-500
  '#84CC16', // M  lime-500
  '#F43F5E', // N  rose-500
  '#14B8A6', // O  teal-500
  '#64748B', // P  slate-500
];

export function colorForLetter(letter: string): string {
  const idx = GROUP_LETTERS.indexOf((letter || '').toUpperCase());
  return GROUP_COLOR_LIST[(idx >= 0 ? idx : 0) % GROUP_COLOR_LIST.length];
}
