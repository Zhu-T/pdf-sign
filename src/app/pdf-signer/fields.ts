export type FieldType = 'signature' | 'initials' | 'name' | 'date' | 'text' | 'checkbox';

export interface Field {
  id: number;
  type: FieldType;
  /** 0-based page index. */
  page: number;
  /** Box as fractions of the displayed (rotated) page, origin top-left. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** PNG data URL for signature/initials, text for name/date/text. */
  value: string;
  checked: boolean;
  /** Font size in PDF points (text-like fields). */
  fontSize: number;
}

export interface FieldDef {
  type: FieldType;
  label: string;
  icon: string;
  /** Default size in PDF points. For signature/initials, w is the max width and h the target height. */
  w: number;
  h: number;
}

export const FIELD_DEFS: FieldDef[] = [
  { type: 'signature', label: 'Signature', icon: '✎', w: 200, h: 40 },
  { type: 'initials', label: 'Initials', icon: 'AB', w: 90, h: 30 },
  { type: 'name', label: 'Full name', icon: 'Aa', w: 160, h: 19 },
  { type: 'date', label: 'Date signed', icon: '31', w: 90, h: 19 },
  { type: 'text', label: 'Text', icon: 'T', w: 180, h: 19 },
  { type: 'checkbox', label: 'Checkbox', icon: '✓', w: 14, h: 14 },
];

export const DEFAULT_FONT_SIZE = 12;
/** Inner padding of text fields, in PDF points. */
export const TEXT_PADDING = 2;
export const LINE_HEIGHT = 1.2;
/** Distance from the top of a line box to the text baseline, as a fraction of the font size. */
export const BASELINE = 0.95;
export const FONT_STACK = 'Arial, Helvetica, sans-serif';
/** Check mark polyline, as fractions of the checkbox. */
export const CHECK_POINTS: [number, number][] = [
  [0.18, 0.52],
  [0.42, 0.76],
  [0.84, 0.24],
];

export function isImageField(type: FieldType): boolean {
  return type === 'signature' || type === 'initials';
}

export function isTextField(type: FieldType): boolean {
  return type === 'name' || type === 'date' || type === 'text';
}

/** Greedy word wrap that matches how a textarea breaks lines. */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.split(/(?<=\s)/)) {
      if (measure(line + word.trimEnd()) <= maxWidth) {
        line += word;
        continue;
      }
      if (line) lines.push(line.trimEnd());
      line = '';
      // Break words that are wider than the box on their own.
      for (const ch of word) {
        if (line && measure(line + ch) > maxWidth) {
          lines.push(line);
          line = '';
        }
        line += ch;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
