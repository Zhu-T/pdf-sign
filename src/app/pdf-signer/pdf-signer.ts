import { Component, ElementRef, HostListener, OnDestroy, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import {
  DEFAULT_FONT_SIZE,
  FIELD_DEFS,
  FONT_STACK,
  CHECK_POINTS,
  Field,
  FieldDef,
  FieldType,
  LINE_HEIGHT,
  TEXT_PADDING,
  isImageField,
  isTextField,
} from './fields';
import { PageGeometry, stampFields } from './pdf-export';
import { AdoptedMark, MarkKind, SignatureDialog } from './signature-dialog/signature-dialog';

type PdfJs = typeof import('pdfjs-dist');

interface Gesture {
  kind: 'move' | 'resize';
  field: Field;
  pointerId: number;
  startX: number;
  startY: number;
  orig: { x: number; y: number; w: number; h: number };
  /** Rendered page size in CSS pixels. */
  pageW: number;
  pageH: number;
  moved: boolean;
  snapshot: string;
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const MIN_FIELD_PT = 8;
/** Largest canvas we will allocate for one page, in pixels. */
const MAX_CANVAS_PIXELS = 16_000_000;

let pdfjsPromise: Promise<PdfJs> | null = null;
function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= import('pdfjs-dist').then(pdfjs => {
    pdfjs.GlobalWorkerOptions.workerSrc = 'pdf.worker.min.mjs';
    return pdfjs;
  });
  return pdfjsPromise;
}

@Component({
  selector: 'app-pdf-signer',
  standalone: true,
  imports: [FormsModule, SignatureDialog],
  templateUrl: './pdf-signer.html',
  styleUrls: ['./pdf-signer.css'],
})
export class PdfSigner implements OnDestroy {
  @ViewChild('scroller') scroller?: ElementRef<HTMLDivElement>;

  readonly defs = FIELD_DEFS;
  readonly fontStack = FONT_STACK;
  readonly lineHeight = LINE_HEIGHT;
  readonly textPadding = TEXT_PADDING;
  readonly checkPoints = CHECK_POINTS.map(p => p.join(',')).join(' ');
  readonly isImageField = isImageField;
  readonly isTextField = isTextField;

  fileName = '';
  /** Displayed page sizes in PDF points. */
  pages: { index: number; width: number; height: number }[] = [];
  fields: Field[] = [];
  zoom = 1;
  tool: FieldType | null = null;
  selectedId: number | null = null;
  loading = false;
  saving = false;
  dragOver = false;
  error = '';

  signature: AdoptedMark | null = null;
  initials: AdoptedMark | null = null;
  fullName = '';
  dialog: { kind: MarkKind; then?: (mark: AdoptedMark) => void } | null = null;

  private pdfBytes: Uint8Array | null = null;
  private pdfDoc: PDFDocumentProxy | null = null;
  private pageProxies: PDFPageProxy[] = [];
  private geometry: PageGeometry[] = [];
  private renderTasks = new Map<number, RenderTask>();
  private renderedZoom = new Map<number, number>();
  private visiblePages = new Set<number>();
  private observer?: IntersectionObserver;
  private history: string[] = [];
  private gesture: Gesture | null = null;
  private nextId = 1;

  ngOnDestroy() {
    this.closeDocument();
  }

  get selected(): Field | undefined {
    return this.fields.find(f => f.id === this.selectedId);
  }

  get canUndo(): boolean {
    return this.history.length > 0;
  }

  get zoomPercent(): number {
    return Math.round(this.zoom * 100);
  }

  defOf(type: FieldType): FieldDef {
    return FIELD_DEFS.find(d => d.type === type)!;
  }

  fieldsOn(page: number): Field[] {
    return this.fields.filter(f => f.page === page);
  }

  // --- Loading ---

  onFileInput(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) this.openFile(file);
  }

  onDragOver(event: DragEvent) {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    this.dragOver = true;
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    this.dragOver = false;
    const file = event.dataTransfer?.files[0];
    if (file) this.openFile(file);
  }

  async openFile(file: File) {
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      this.error = `"${file.name}" is not a PDF.`;
      return;
    }
    if (this.fields.length && !confirm('Open a different PDF? Fields on the current document will be discarded.')) {
      return;
    }

    this.error = '';
    this.loading = true;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const pdfjs = await loadPdfJs();
      // pdf.js takes ownership of the buffer it is given, so hand it a copy.
      const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
      const proxies = await Promise.all(
        Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1)),
      );

      this.closeDocument();
      this.pdfDoc = doc;
      this.pdfBytes = bytes;
      this.pageProxies = proxies;
      this.fileName = file.name;
      this.geometry = proxies.map(page => {
        const vp = page.getViewport({ scale: 1 });
        return {
          width: vp.width,
          height: vp.height,
          rotation: vp.rotation,
          toPdfPoint: (x, y) => vp.convertToPdfPoint(x, y) as [number, number],
        };
      });
      this.pages = this.geometry.map((g, index) => ({ index, width: g.width, height: g.height }));

      // Wait for the pages to be laid out before measuring and observing them.
      setTimeout(() => {
        this.fitWidth();
        this.observePages();
      });
    } catch (e: any) {
      this.error =
        e?.name === 'PasswordException'
          ? 'This PDF is password protected. Remove the password and try again.'
          : `Could not open "${file.name}": ${e?.message ?? e}`;
    } finally {
      this.loading = false;
    }
  }

  private closeDocument() {
    this.observer?.disconnect();
    this.renderTasks.forEach(task => task.cancel());
    this.renderTasks.clear();
    this.renderedZoom.clear();
    this.visiblePages.clear();
    this.pdfDoc?.destroy();
    this.pdfDoc = null;
    this.pdfBytes = null;
    this.pageProxies = [];
    this.geometry = [];
    this.pages = [];
    this.fields = [];
    this.history = [];
    this.selectedId = null;
    this.tool = null;
  }

  // --- Rendering ---

  private observePages() {
    const root = this.scroller?.nativeElement;
    if (!root) return;
    this.observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          const index = Number((entry.target as HTMLElement).dataset['index']);
          if (entry.isIntersecting) {
            this.visiblePages.add(index);
            this.renderPage(index);
          } else {
            this.visiblePages.delete(index);
          }
        }
      },
      { root, rootMargin: '400px 0px' },
    );
    root.querySelectorAll('.page').forEach(el => this.observer!.observe(el));
  }

  private async renderPage(index: number) {
    const proxy = this.pageProxies[index];
    const holder = this.scroller?.nativeElement.querySelector<HTMLElement>(`.canvas-holder[data-page="${index}"]`);
    if (!proxy || !holder || this.renderedZoom.get(index) === this.zoom) return;

    this.renderTasks.get(index)?.cancel();
    const zoom = this.zoom;
    const base = proxy.getViewport({ scale: 1 });
    let scale = zoom * (window.devicePixelRatio || 1);
    scale = Math.min(scale, Math.sqrt(MAX_CANVAS_PIXELS / (base.width * base.height)));
    const viewport = proxy.getViewport({ scale });

    // Render off-screen and swap in when done, so zooming never flashes a blank page.
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const pdfjs = await loadPdfJs();
    const task = proxy.render({ canvas, viewport, annotationMode: pdfjs.AnnotationMode.ENABLE });
    this.renderTasks.set(index, task);
    try {
      await task.promise;
      holder.replaceChildren(canvas);
      this.renderedZoom.set(index, zoom);
    } catch (e) {
      if (!(e instanceof pdfjs.RenderingCancelledException)) console.error(e);
    } finally {
      if (this.renderTasks.get(index) === task) this.renderTasks.delete(index);
    }
  }

  setZoom(zoom: number) {
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    if (zoom === this.zoom) return;
    const el = this.scroller?.nativeElement;
    const ratio = el && el.scrollHeight ? el.scrollTop / el.scrollHeight : 0;
    this.zoom = zoom;
    setTimeout(() => {
      if (el) el.scrollTop = ratio * el.scrollHeight;
      this.visiblePages.forEach(i => this.renderPage(i));
    });
  }

  zoomBy(factor: number) {
    this.setZoom(Math.round(this.zoom * factor * 100) / 100);
  }

  fitWidth() {
    const el = this.scroller?.nativeElement;
    if (!el || !this.pages.length) return;
    const widest = Math.max(...this.pages.map(p => p.width));
    this.setZoom(Math.min(1.5, (el.clientWidth - 48) / widest));
    // setZoom is a no-op when the zoom is unchanged, so make sure the first pages render.
    setTimeout(() => this.visiblePages.forEach(i => this.renderPage(i)));
  }

  // --- Placing fields ---

  selectTool(type: FieldType) {
    this.tool = this.tool === type ? null : type;
    this.selectedId = null;
  }

  onPagePointerDown(event: PointerEvent, pageIndex: number) {
    if (event.button !== 0) return;
    if (!this.tool) {
      this.selectedId = null;
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const fx = (event.clientX - rect.left) / rect.width;
    const fy = (event.clientY - rect.top) / rect.height;
    const type = this.tool;
    this.tool = null;
    event.preventDefault();
    this.placeField(type, pageIndex, fx, fy);
  }

  private placeField(type: FieldType, page: number, cx: number, cy: number) {
    if (isImageField(type)) {
      const mark = this[type as MarkKind];
      if (!mark) {
        this.openDialog(type as MarkKind, () => this.placeField(type, page, cx, cy));
        return;
      }
    }

    const geo = this.geometry[page];
    const def = this.defOf(type);
    let wPt = def.w;
    let hPt = def.h;
    let value = '';
    if (isImageField(type)) {
      const mark = this[type as MarkKind]!;
      ({ w: wPt, h: hPt } = fitMark(mark.aspect, def));
      value = mark.dataUrl;
    } else if (type === 'name') {
      value = this.fullName;
    } else if (type === 'date') {
      value = new Date().toLocaleDateString();
    }

    const w = Math.min(1, wPt / geo.width);
    const h = Math.min(1, hPt / geo.height);
    const field: Field = {
      id: this.nextId++,
      type,
      page,
      x: clamp(cx - w / 2, 0, 1 - w),
      y: clamp(cy - h / 2, 0, 1 - h),
      w,
      h,
      value,
      checked: type === 'checkbox',
      fontSize: DEFAULT_FONT_SIZE,
    };

    this.pushHistory();
    this.fields = [...this.fields, field];
    this.selectedId = field.id;
    if (isTextField(type)) this.focusField(field.id);
  }

  private focusField(id: number) {
    setTimeout(() => {
      const el = this.scroller?.nativeElement.querySelector<HTMLTextAreaElement>(`[data-field="${id}"] textarea`);
      el?.focus();
      el?.select();
    });
  }

  // --- Signatures ---

  openDialog(kind: MarkKind, then?: (mark: AdoptedMark) => void) {
    this.dialog = { kind, then };
  }

  onAdopt(mark: AdoptedMark) {
    const dialog = this.dialog;
    if (!dialog) return;
    this.dialog = null;
    this[dialog.kind] = mark;
    if (mark.name) this.fullName = mark.name;

    // A newly adopted mark replaces the one already placed on the document.
    const placed = this.fields.filter(f => f.type === dialog.kind);
    if (placed.length) {
      this.pushHistory();
      for (const f of placed) {
        const geo = this.geometry[f.page];
        f.value = mark.dataUrl;
        f.h = Math.min((f.w * geo.width) / mark.aspect / geo.height, 1 - f.y);
      }
    }
    dialog.then?.(mark);
  }

  // --- Editing fields ---

  onFieldPointerDown(event: PointerEvent, field: Field) {
    event.stopPropagation();
    if (event.button !== 0) return;
    this.selectedId = field.id;
    this.tool = null;
    // Let text fields take focus and the caret instead of starting a drag.
    if ((event.target as HTMLElement).tagName === 'TEXTAREA') return;
    event.preventDefault();
    // preventDefault keeps focus where it was, so release any text field being edited.
    (document.activeElement as HTMLElement | null)?.blur();
    this.startGesture(event, field, 'move');
  }

  onHandlePointerDown(event: PointerEvent, field: Field, kind: 'move' | 'resize') {
    event.stopPropagation();
    if (event.button !== 0) return;
    event.preventDefault();
    this.selectedId = field.id;
    this.startGesture(event, field, kind);
  }

  private startGesture(event: PointerEvent, field: Field, kind: 'move' | 'resize') {
    const pageEl = (event.target as HTMLElement).closest('.page')!;
    const rect = pageEl.getBoundingClientRect();
    this.gesture = {
      kind,
      field,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      orig: { x: field.x, y: field.y, w: field.w, h: field.h },
      pageW: rect.width,
      pageH: rect.height,
      moved: false,
      snapshot: JSON.stringify(this.fields),
    };
  }

  @HostListener('window:pointermove', ['$event'])
  onPointerMove(event: PointerEvent) {
    const g = this.gesture;
    if (!g || event.pointerId !== g.pointerId) return;
    const dxPx = event.clientX - g.startX;
    const dyPx = event.clientY - g.startY;
    if (!g.moved && Math.hypot(dxPx, dyPx) < 3) return;
    g.moved = true;

    const f = g.field;
    const dx = dxPx / g.pageW;
    const dy = dyPx / g.pageH;
    if (g.kind === 'move') {
      f.x = clamp(g.orig.x + dx, 0, 1 - f.w);
      f.y = clamp(g.orig.y + dy, 0, 1 - f.h);
      return;
    }

    const geo = this.geometry[f.page];
    const minW = MIN_FIELD_PT / geo.width;
    const minH = MIN_FIELD_PT / geo.height;
    let w = clamp(g.orig.w + dx, minW, 1 - f.x);
    let h = clamp(g.orig.h + dy, minH, 1 - f.y);
    if (f.type !== 'text' && f.type !== 'name' && f.type !== 'date') {
      // Signatures, initials and checkboxes keep their shape.
      const aspect = (g.orig.w * geo.width) / (g.orig.h * geo.height);
      h = (w * geo.width) / aspect / geo.height;
      if (h > 1 - f.y) {
        h = 1 - f.y;
        w = (h * geo.height * aspect) / geo.width;
      }
    }
    f.w = w;
    f.h = h;
  }

  @HostListener('window:pointerup', ['$event'])
  @HostListener('window:pointercancel', ['$event'])
  onPointerUp(event: PointerEvent) {
    const g = this.gesture;
    if (!g || event.pointerId !== g.pointerId) return;
    this.gesture = null;
    if (g.moved) {
      this.history.push(g.snapshot);
    } else if (g.kind === 'move' && g.field.type === 'checkbox' && event.type === 'pointerup') {
      this.pushHistory();
      g.field.checked = !g.field.checked;
    }
  }

  onTextInput(event: Event, field: Field) {
    // Grow the box downwards as lines are added, like DocuSign's text fields.
    const el = event.target as HTMLTextAreaElement;
    if (el.scrollHeight > el.clientHeight + 1) {
      const pageH = el.closest('.page')!.getBoundingClientRect().height;
      field.h = Math.min(1 - field.y, field.h + (el.scrollHeight - el.clientHeight) / pageH);
    }
    if (field.type === 'name') this.fullName = field.value;
  }

  changeFontSize(field: Field, delta: number) {
    const size = clamp(field.fontSize + delta, 6, 48);
    if (size === field.fontSize) return;
    this.pushHistory();
    const geo = this.geometry[field.page];
    const minH = (size * LINE_HEIGHT + 2 * TEXT_PADDING) / geo.height;
    field.fontSize = size;
    field.h = Math.min(Math.max(field.h, minH), 1 - field.y);
  }

  deleteField(field: Field) {
    this.pushHistory();
    this.fields = this.fields.filter(f => f.id !== field.id);
    if (this.selectedId === field.id) this.selectedId = null;
  }

  copyToAllPages(field: Field) {
    const copies = this.pages
      .filter(p => p.index !== field.page)
      .map(p => ({
        ...field,
        id: this.nextId++,
        page: p.index,
        x: Math.min(field.x, 1 - field.w),
        y: Math.min(field.y, 1 - field.h),
      }));
    if (!copies.length) return;
    this.pushHistory();
    this.fields = [...this.fields, ...copies];
  }

  private pushHistory() {
    this.history.push(JSON.stringify(this.fields));
    if (this.history.length > 100) this.history.shift();
  }

  undo() {
    const snapshot = this.history.pop();
    if (snapshot === undefined) return;
    this.fields = JSON.parse(snapshot);
    this.selectedId = null;
    this.gesture = null;
  }

  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent) {
    if (this.dialog) return;
    const target = event.target as HTMLElement;
    const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';

    if (event.key === 'Escape') {
      if (typing) target.blur();
      this.tool = null;
      this.selectedId = null;
      return;
    }
    if (typing || !this.pages.length) return;

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      this.undo();
      return;
    }

    const f = this.selected;
    if (!f) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      this.deleteField(f);
      return;
    }

    const step = event.shiftKey ? 10 : 1;
    const nudge: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = nudge[event.key];
    if (delta) {
      event.preventDefault();
      this.pushHistory();
      const geo = this.geometry[f.page];
      f.x = clamp(f.x + delta[0] / geo.width, 0, 1 - f.w);
      f.y = clamp(f.y + delta[1] / geo.height, 0, 1 - f.h);
    }
  }

  // --- Saving ---

  get emptyTextFields(): number {
    return this.fields.filter(f => isTextField(f.type) && !f.value.trim()).length;
  }

  async download() {
    if (!this.pdfBytes || this.saving) return;
    const empty = this.emptyTextFields;
    if (empty && !confirm(`${empty} text field${empty > 1 ? 's are' : ' is'} empty and will be left out. Download anyway?`)) {
      return;
    }

    this.saving = true;
    this.error = '';
    try {
      const bytes = await stampFields(this.pdfBytes, this.fields, this.geometry);
      const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = this.fileName || 'document.pdf';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e: any) {
      this.error = `Could not save the PDF: ${e?.message ?? e}`;
    } finally {
      this.saving = false;
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/** Default size for a signature or initials image, within the field definition's bounds. */
function fitMark(aspect: number, def: FieldDef): { w: number; h: number } {
  let h = def.h;
  let w = h * aspect;
  if (w > def.w) {
    w = def.w;
    h = w / aspect;
  }
  return { w, h };
}
