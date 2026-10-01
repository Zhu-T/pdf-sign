import { PDFDocument, degrees } from 'pdf-lib';
import { Field, wrapText } from './fields';
import { PageGeometry, stampFields } from './pdf-export';

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function field(partial: Partial<Field>): Field {
  return {
    id: 1, type: 'text', page: 0, x: 0.1, y: 0.1, w: 0.5, h: 0.05,
    value: '', checked: false, fontSize: 12, ...partial,
  };
}

/** Geometry for an unrotated page whose media box starts at the origin. */
function flatGeometry(width: number, height: number): PageGeometry {
  return { width, height, rotation: 0, toPdfPoint: (x, y) => [x, height - y] };
}

describe('wrapText', () => {
  const measure = (s: string) => s.length;

  it('wraps on word boundaries', () => {
    expect(wrapText('aaa bbb ccc', 7, measure)).toEqual(['aaa bbb', 'ccc']);
  });

  it('keeps explicit line breaks and blank lines', () => {
    expect(wrapText('a\n\nb', 10, measure)).toEqual(['a', '', 'b']);
  });

  it('breaks words longer than the line', () => {
    expect(wrapText('abcdefgh', 3, measure)).toEqual(['abc', 'def', 'gh']);
  });
});

describe('stampFields', () => {
  async function blankPdf(rotation = 0): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    doc.addPage([600, 800]).setRotation(degrees(rotation));
    doc.addPage([600, 800]);
    return doc.save();
  }

  it('produces a valid PDF with every field type', async () => {
    const out = await stampFields(
      await blankPdf(),
      [
        field({ type: 'text', value: 'Hello world, this wraps onto a second line' }),
        field({ type: 'date', value: '1/2/2026', page: 1 }),
        field({ type: 'checkbox', checked: true, w: 0.03, h: 0.02 }),
        field({ type: 'signature', value: PNG_1PX, y: 0.5 }),
        field({ type: 'text', value: '你好' }),
        field({ type: 'text', value: '   ' }),
      ],
      [flatGeometry(600, 800), flatGeometry(600, 800)],
    );

    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(2);
    expect(out.length).toBeGreaterThan((await blankPdf()).length);
  });

  it('maps displayed coordinates through the page geometry', async () => {
    const calls: [number, number][] = [];
    const geo: PageGeometry = {
      width: 800,
      height: 600,
      rotation: 90,
      toPdfPoint: (x, y) => {
        calls.push([x, y]);
        return [y, x];
      },
    };
    await stampFields(
      await blankPdf(90),
      [field({ type: 'signature', value: PNG_1PX, x: 0.25, y: 0.5, w: 0.1, h: 0.1 })],
      [geo],
    );
    // A square image in an 80x60 box is 60x60, centred horizontally; its anchor is the bottom-left.
    expect(calls).toEqual([[200 + 10, 300 + 60]]);
  });
});
