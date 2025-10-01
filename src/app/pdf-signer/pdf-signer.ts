import { Component, ElementRef, ViewChild, AfterViewInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PDFDocumentProxy } from 'ng2-pdf-viewer';
import { SharedModule } from '../shared/shared.module';
import { PDFDocument } from 'pdf-lib';
import SignaturePad from 'signature_pad';

@Component({
  selector: 'app-pdf-signer',
  standalone: true,
  imports: [SharedModule, FormsModule],   // ✅ just bring in SharedModule
  templateUrl: './pdf-signer.html',
  styleUrls: ['./pdf-signer.css']
})
export class PdfSigner implements AfterViewInit {
  pdfSrc: string | null = null;
  pdfBytes: Uint8Array | null = null;

  @ViewChild('sigPad') set signatureCanvas(canvas: ElementRef<HTMLCanvasElement> | undefined) {
    if (canvas) this.signaturePad = new SignaturePad(canvas.nativeElement);
  }
  private signaturePad?: SignaturePad;

  @ViewChild('pdfContainer', { static: false }) pdfContainer?: ElementRef<HTMLDivElement>;

  signatureDataUrl: string | null = null;
  signatureDisplayUrl: string | null = null;

  sigPosX = 50;
  sigPosY = 50;
  sigWidth = 150;
  sigHeight = 75;
  sigPage = 1;

  totalPages = 1;
  pageNumbers: number[] = [];

  private dragging = false;
  private dragOffsetX = 0;
  private dragOffsetY = 0;

  private resizing = false;
  private resizeStartX = 0;
  private resizeStartY = 0;
  private startWidth = 0;
  private startHeight = 0;

  // Zoom factor
  pdfScale?: number;

  ngAfterViewInit() {
    document.addEventListener('mousemove', e => this.onDrag(e));
    document.addEventListener('mouseup', e => this.stopDrag(e));
    document.addEventListener('touchmove', e => this.onDrag(e));
    document.addEventListener('touchend', e => this.stopDrag(e));
  }

  async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;

    const file = input.files[0];
    if (this.pdfSrc) URL.revokeObjectURL(this.pdfSrc);
    this.pdfSrc = URL.createObjectURL(file);

    const buffer = await file.arrayBuffer();
    this.pdfBytes = new Uint8Array(buffer);
  }

  clearSignature() {
    this.signaturePad?.clear();
    this.signatureDataUrl = null;
    this.signatureDisplayUrl = null;
  }

  useCanvasSignature() {
    if (!this.signaturePad || this.signaturePad.isEmpty()) return;

    this.signatureDataUrl = this.signaturePad.toDataURL('image/png');
    this.signatureDisplayUrl = this.signatureDataUrl;

    this.sigPosX = 50;
    this.sigPosY = 50;
  }

  onSignatureUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;

    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result) {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0);

            // Remove white background
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            for (let i = 0; i < data.length; i += 4) {
              const r = data[i], g = data[i + 1], b = data[i + 2];
              if (r > 240 && g > 240 && b > 240) {
                data[i + 3] = 0;
              }
            }
            ctx.putImageData(imageData, 0, 0);

            this.signatureDataUrl = canvas.toDataURL('image/png');
            this.signatureDisplayUrl = this.signatureDataUrl;

            this.sigPosX = 50;
            this.sigPosY = 50;
          }
        };
        img.src = reader.result as string;
      }
    };
    reader.readAsDataURL(file);
  }

  startDrag(event: MouseEvent | TouchEvent) {
    event.preventDefault();
    this.dragging = true;

    let clientX = 0, clientY = 0;
    if (event instanceof MouseEvent) {
      clientX = event.clientX;
      clientY = event.clientY;
    } else if (event instanceof TouchEvent) {
      clientX = event.touches[0].clientX;
      clientY = event.touches[0].clientY;
    }

    const containerRect = this.pdfContainer?.nativeElement.getBoundingClientRect();
    if (containerRect) {
      this.dragOffsetX = clientX - containerRect.left - this.sigPosX;
      this.dragOffsetY = clientY - containerRect.top - this.sigPosY;
    }
  }

  startResize(event: MouseEvent | TouchEvent) {
    event.stopPropagation();
    event.preventDefault();
    this.resizing = true;

    let clientX = 0, clientY = 0;
    if (event instanceof MouseEvent) {
      clientX = event.clientX;
      clientY = event.clientY;
    } else if (event instanceof TouchEvent) {
      clientX = event.touches[0].clientX;
      clientY = event.touches[0].clientY;
    }

    this.resizeStartX = clientX;
    this.resizeStartY = clientY;
    this.startWidth = this.sigWidth;
    this.startHeight = this.sigHeight;
  }

  onDrag(event: MouseEvent | TouchEvent) {
    if (!this.pdfContainer) return;

    let clientX = 0, clientY = 0;
    if (event instanceof MouseEvent) {
      clientX = event.clientX;
      clientY = event.clientY;
    } else if (event instanceof TouchEvent) {
      clientX = event.touches[0].clientX;
      clientY = event.touches[0].clientY;
    }

    const container = this.pdfContainer.nativeElement;
    const containerRect = container.getBoundingClientRect();
    const pageElements = container.querySelectorAll('.page');
    const pageElement = pageElements[this.sigPage - 1] as HTMLElement;
    const pageRect = pageElement.getBoundingClientRect();

    if (this.dragging) {
      let newX = clientX - containerRect.left - this.dragOffsetX;
      let newY = clientY - containerRect.top - this.dragOffsetY;

      // Clamp to page bounds
      const minX = pageRect.left - containerRect.left;
      const minY = pageRect.top - containerRect.top;
      const maxX = minX + pageRect.width - this.sigWidth;
      const maxY = minY + pageRect.height - this.sigHeight;

      this.sigPosX = Math.min(Math.max(newX, minX), maxX);
      this.sigPosY = Math.min(Math.max(newY, minY), maxY);
    } else if (this.resizing) {
      let deltaX = clientX - this.resizeStartX;
      let deltaY = clientY - this.resizeStartY;

      this.sigWidth = Math.max(20, this.startWidth + deltaX);
      this.sigHeight = Math.max(20, this.startHeight + deltaY);

      // Constrain to page bounds
      const minX = pageRect.left - containerRect.left;
      const minY = pageRect.top - containerRect.top;
      const maxWidth = pageRect.width - (this.sigPosX - minX);
      const maxHeight = pageRect.height - (this.sigPosY - minY);

      this.sigWidth = Math.min(this.sigWidth, maxWidth);
      this.sigHeight = Math.min(this.sigHeight, maxHeight);
    }
  }

  stopDrag(event: MouseEvent | TouchEvent) {
    this.dragging = false;
    this.resizing = false;
  }

  async onPdfLoad(pdf: PDFDocumentProxy) {
    this.totalPages = pdf.numPages;
    this.pageNumbers = Array.from({ length: pdf.numPages }, (_, i) => i + 1);
  
    const page = await pdf.getPage(1); // async
    const viewport = page.getViewport({ scale: 1 });
    this.pdfScale = viewport.scale; // now it's a number
  }

  async applySignature() {
    if (!this.pdfBytes) return;
    const pdfDoc = await PDFDocument.load(this.pdfBytes);
    const pages = pdfDoc.getPages();
    const page = pages[0]; // always use the first page
  
    if (!this.signatureDataUrl) return alert('Please draw or upload a signature!');
    const pngImage = await pdfDoc.embedPng(this.signatureDataUrl);
  
    const container = this.pdfContainer?.nativeElement;
    const containerWidth = container?.clientWidth || page.getWidth();
    const containerHeight = container?.clientHeight || page.getHeight();
  
    const scaleX = page.getWidth() / containerWidth;
    const scaleY = page.getHeight() / containerHeight;
  
    page.drawImage(pngImage, {
      x: this.sigPosX * scaleX,
      y: page.getHeight() - (this.sigPosY + this.sigHeight) * scaleY,
      width: this.sigWidth * scaleX,
      height: this.sigHeight * scaleY,
    });
  
    const signedPdfBytes = await pdfDoc.save();
    this.downloadPdf(signedPdfBytes);
  }

  downloadPdf(bytes: Uint8Array) {
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'signed.pdf';
    a.click();
    URL.revokeObjectURL(url);
  }
}