import {
  LineCapStyle,
  PDFDocument,
  PDFFont,
  PDFImage,
  PDFPage,
  StandardFonts,
  degrees,
  rgb,
} from 'pdf-lib';
import {
  BASELINE,
  CHECK_POINTS,
  FONT_STACK,
  Field,
  LINE_HEIGHT,
  TEXT_PADDING,
  isImageField,
  isTextField,
  wrapText,
} from './fields';

/** How a page is displayed, in PDF points at scale 1 (rotation and crop box applied). */
export interface PageGeometry {
  width: number;
  height: number;
  /** Page rotation in degrees clockwise: 0, 90, 180 or 270. */
  rotation: number;
  /** Maps a displayed point (origin top-left) to PDF user space. */
  toPdfPoint(x: number, y: number): [number, number];
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const INK = rgb(0, 0, 0);

/** Draws every field onto the PDF and returns the new file. */
export async function stampFields(
  pdfBytes: Uint8Array,
  fields: Field[],
  geometry: PageGeometry[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const images = new Map<string, PDFImage>();
  const embed = async (dataUrl: string) => {
    let img = images.get(dataUrl);
    if (!img) {
      img = await doc.embedPng(dataUrl);
      images.set(dataUrl, img);
    }
    return img;
  };

  for (const field of fields) {
    const page = pages[field.page];
    const geo = geometry[field.page];
    if (!page || !geo) continue;
    const box: Box = {
      x: field.x * geo.width,
      y: field.y * geo.height,
      w: field.w * geo.width,
      h: field.h * geo.height,
    };

    if (isImageField(field.type)) {
      if (field.value) drawImageContained(page, geo, await embed(field.value), box);
    } else if (isTextField(field.type)) {
      if (field.value.trim()) await drawText(page, geo, font, field, box, embed);
    } else if (field.type === 'checkbox' && field.checked) {
      drawCheck(page, geo, box);
    }
  }

  return doc.save();
}

/** Draws an image so that it appears upright in `box`, keeping its aspect ratio. */
function drawImageContained(page: PDFPage, geo: PageGeometry, img: PDFImage, box: Box) {
  const scale = Math.min(box.w / img.width, box.h / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  drawImageAt(page, geo, img, {
    x: box.x + (box.w - w) / 2,
    y: box.y + (box.h - h) / 2,
    w,
    h,
  });
}

function drawImageAt(page: PDFPage, geo: PageGeometry, img: PDFImage, box: Box) {
  // pdf-lib rotates around the image's bottom-left corner, counter-clockwise; undoing the
  // page's clockwise rotation keeps the image upright on screen.
  const [x, y] = geo.toPdfPoint(box.x, box.y + box.h);
  page.drawImage(img, { x, y, width: box.w, height: box.h, rotate: degrees(geo.rotation) });
}

async function drawText(
  page: PDFPage,
  geo: PageGeometry,
  font: PDFFont,
  field: Field,
  box: Box,
  embed: (dataUrl: string) => Promise<PDFImage>,
) {
  const size = field.fontSize;
  const measure = (s: string) =>
    canEncode(font, s) ? font.widthOfTextAtSize(s, size) : measureWithCanvas(s, size);
  const lines = wrapText(field.value, box.w - 2 * TEXT_PADDING, measure);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const left = box.x + TEXT_PADDING;
    const top = box.y + TEXT_PADDING + i * size * LINE_HEIGHT;

    if (canEncode(font, line)) {
      const [x, y] = geo.toPdfPoint(left, top + size * BASELINE);
      page.drawText(line, { x, y, size, font, color: INK, rotate: degrees(geo.rotation) });
    } else {
      // The standard fonts only cover Latin text, so other scripts are drawn as an image.
      const img = await embed(renderTextImage(line, size));
      drawImageAt(page, geo, img, { x: left, y: top, w: measureWithCanvas(line, size), h: size * LINE_HEIGHT });
    }
  }
}

function drawCheck(page: PDFPage, geo: PageGeometry, box: Box) {
  const thickness = Math.max(1, Math.min(box.w, box.h) * 0.12);
  const points = CHECK_POINTS.map(([fx, fy]) => {
    const [x, y] = geo.toPdfPoint(box.x + fx * box.w, box.y + fy * box.h);
    return { x, y };
  });
  for (let i = 1; i < points.length; i++) {
    page.drawLine({
      start: points[i - 1],
      end: points[i],
      thickness,
      color: INK,
      lineCap: LineCapStyle.Round,
    });
  }
}

function canEncode(font: PDFFont, text: string): boolean {
  try {
    font.encodeText(text);
    return true;
  } catch {
    return false;
  }
}

const TEXT_IMAGE_SCALE = 4;
let measureCtx: CanvasRenderingContext2D | null = null;

function measureWithCanvas(text: string, size: number): number {
  measureCtx ??= document.createElement('canvas').getContext('2d')!;
  measureCtx.font = `${size}px ${FONT_STACK}`;
  return measureCtx.measureText(text).width;
}

function renderTextImage(text: string, size: number): string {
  const s = TEXT_IMAGE_SCALE;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(measureWithCanvas(text, size) * s) || 1;
  canvas.height = Math.ceil(size * LINE_HEIGHT * s);
  const ctx = canvas.getContext('2d')!;
  ctx.font = `${size * s}px ${FONT_STACK}`;
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, 0, size * BASELINE * s);
  return canvas.toDataURL('image/png');
}
