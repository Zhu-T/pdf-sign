import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import SignaturePad from 'signature_pad';

export type MarkKind = 'signature' | 'initials';

export interface AdoptedMark {
  /** Transparent PNG, trimmed to the ink. */
  dataUrl: string;
  /** width / height */
  aspect: number;
  /** The name typed in the dialog, when there is one. */
  name?: string;
}

export const SCRIPT_FONTS = ['Dancing Script', 'Great Vibes', 'Caveat', 'Satisfy'];
const INK_COLORS = ['#111111', '#1d3f9a'];

@Component({
  selector: 'app-signature-dialog',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './signature-dialog.html',
  styleUrls: ['./signature-dialog.css'],
})
export class SignatureDialog implements OnInit, OnDestroy {
  @Input() kind: MarkKind = 'signature';
  @Input() name = '';
  @Output() adopt = new EventEmitter<AdoptedMark>();
  @Output() cancel = new EventEmitter<void>();

  tab: 'type' | 'draw' | 'upload' = 'type';
  typed = '';
  fonts = SCRIPT_FONTS;
  font = SCRIPT_FONTS[0];
  inkColors = INK_COLORS;
  ink = INK_COLORS[0];
  uploaded: string | null = null;
  drawnEmpty = true;
  error = '';

  private pad?: SignaturePad;
  private padEl?: HTMLCanvasElement;
  private resizeObserver?: ResizeObserver;

  @ViewChild('typedInput') set typedInput(ref: ElementRef<HTMLInputElement> | undefined) {
    // The autofocus attribute is ignored for elements added after page load.
    ref?.nativeElement.focus();
  }

  @ViewChild('pad') set padCanvas(ref: ElementRef<HTMLCanvasElement> | undefined) {
    this.pad?.off();
    this.resizeObserver?.disconnect();
    this.pad = undefined;
    if (!ref) return;

    const canvas = (this.padEl = ref.nativeElement);
    this.pad = new SignaturePad(canvas, { penColor: this.ink, minWidth: 1, maxWidth: 3 });
    this.pad.addEventListener('endStroke', () => (this.drawnEmpty = this.pad!.isEmpty()));
    this.resizeObserver = new ResizeObserver(() => this.fitPad(canvas));
    this.resizeObserver.observe(canvas);
  }

  get title(): string {
    return this.kind === 'signature' ? 'Adopt your signature' : 'Adopt your initials';
  }

  ngOnInit() {
    this.typed = this.kind === 'initials' ? initialsOf(this.name) : this.name;
  }

  ngOnDestroy() {
    this.pad?.off();
    this.resizeObserver?.disconnect();
  }

  get canAdopt(): boolean {
    if (this.tab === 'type') return this.typed.trim().length > 0;
    if (this.tab === 'draw') return !this.drawnEmpty;
    return !!this.uploaded;
  }

  onBackdropPointerDown(event: PointerEvent) {
    // Must not return false: Angular would call preventDefault and stop inputs taking focus.
    if (event.target === event.currentTarget) this.cancel.emit();
  }

  setInk(color: string) {
    this.ink = color;
    if (!this.pad) return;
    this.pad.penColor = color;
    // Recolor what has already been drawn.
    this.pad.fromData(this.pad.toData().map(group => ({ ...group, penColor: color })));
  }

  clearPad() {
    this.pad?.clear();
    this.drawnEmpty = true;
  }

  onUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.error = '';

    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);

      // Make a white background transparent so the signature sits on the page cleanly.
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240) data[i + 3] = 0;
      }
      ctx.putImageData(imageData, 0, 0);

      const mark = trimCanvas(canvas);
      if (mark) this.uploaded = mark.dataUrl;
      else this.error = 'That image looks blank.';
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      this.error = 'That file could not be read as an image.';
    };
    img.src = url;
  }

  async submit() {
    if (!this.canAdopt) return;
    let mark: AdoptedMark | null = null;

    if (this.tab === 'type') {
      const text = this.typed.trim();
      mark = await renderTyped(text, this.font, this.ink);
      if (mark && this.kind === 'signature') mark.name = text;
    } else if (this.tab === 'draw' && this.pad) {
      mark = trimCanvas(this.padEl!);
    } else if (this.uploaded) {
      const img = await loadImage(this.uploaded);
      mark = { dataUrl: this.uploaded, aspect: img.naturalWidth / img.naturalHeight };
    }

    if (mark) this.adopt.emit(mark);
    else this.error = 'Nothing to adopt yet.';
  }

  private fitPad(canvas: HTMLCanvasElement) {
    if (!this.pad) return;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const width = canvas.offsetWidth * ratio;
    const height = canvas.offsetHeight * ratio;
    if (!width || (canvas.width === width && canvas.height === height)) return;

    const data = this.pad.toData();
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')!.scale(ratio, ratio);
    this.pad.clear();
    this.pad.fromData(data);
  }
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part[0].toUpperCase())
    .join('');
}

async function renderTyped(text: string, font: string, color: string): Promise<AdoptedMark | null> {
  const size = 96;
  const css = `${size}px "${font}"`;
  await document.fonts.load(css, text);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = css;
  canvas.width = Math.ceil(ctx.measureText(text).width + size);
  canvas.height = Math.ceil(size * 1.8);
  // Resizing resets the context.
  ctx.font = css;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, size / 2, canvas.height / 2);
  return trimCanvas(canvas);
}

/** Crops a canvas to its non-transparent pixels. */
export function trimCanvas(source: HTMLCanvasElement, margin = 4): AdoptedMark | null {
  const { width, height } = source;
  if (!width || !height) return null;
  const data = source.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, width, height).data;

  let top = height, left = width, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) return null;

  const w = right - left + 1;
  const h = bottom - top + 1;
  const out = document.createElement('canvas');
  out.width = w + margin * 2;
  out.height = h + margin * 2;
  out.getContext('2d')!.drawImage(source, left, top, w, h, margin, margin, w, h);
  return { dataUrl: out.toDataURL('image/png'), aspect: out.width / out.height };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
