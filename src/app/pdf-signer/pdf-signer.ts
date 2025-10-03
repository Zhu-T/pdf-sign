import { Component, ElementRef, ViewChild, AfterViewInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PDFDocumentProxy } from 'ng2-pdf-viewer';
import { SharedModule } from '../shared/shared.module';
import { PDFDocument } from 'pdf-lib';
import SignaturePad from 'signature_pad';

@Component({
  selector: 'app-pdf-signer',
  standalone: true,
  imports: [SharedModule, FormsModule],
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

  sigPosX = 0;
  sigPosY = 0;
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

  private file_name = 'document.pdf';
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
    this.file_name = file.name;
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

    this.centerSignature();
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
              if (data[i] > 240 && data[i+1] > 240 && data[i+2] > 240) data[i+3] = 0;
            }
            ctx.putImageData(imageData, 0, 0);

            this.signatureDataUrl = canvas.toDataURL('image/png');
            this.signatureDisplayUrl = this.signatureDataUrl;

            this.centerSignature();
          }
        };
        img.src = reader.result as string;
      }
    };
    reader.readAsDataURL(file);
  }

  /** Center signature on current page */
  centerSignature() {
    if (!this.pdfContainer) return;
    const pageElements = this.pdfContainer.nativeElement.querySelectorAll('.page');
    const pageElement = pageElements[this.sigPage - 1] as HTMLElement;
    if (!pageElement) return;

    this.sigPosX = (pageElement.clientWidth - this.sigWidth) / 2;
    this.sigPosY = (pageElement.clientHeight - this.sigHeight) / 2;
  }

  startDrag(event: MouseEvent | TouchEvent) {
    event.preventDefault();
    this.dragging = true;

    let clientX = 0, clientY = 0;
    if (event instanceof MouseEvent) { clientX = event.clientX; clientY = event.clientY; }
    else if (event instanceof TouchEvent) { clientX = event.touches[0].clientX; clientY = event.touches[0].clientY; }

    const pageElements = this.pdfContainer?.nativeElement.querySelectorAll('.page');
    const pageElement = pageElements![this.sigPage - 1] as HTMLElement;
    if (!pageElement) return;

    const pageRect = pageElement.getBoundingClientRect();
    const containerRect = this.pdfContainer!.nativeElement.getBoundingClientRect();

    // Calculate the drag offset (distance from click to signature's top-left corner)
    // The client coordinates (clientX, clientY) are absolute screen positions.
    // The signature position (sigPosX, sigPosY) is relative to the container.
    
    // We calculate dragOffsetX/Y using the signature's current position relative to the PAGE.
    const sigX_PageRelative = this.sigPosX - (pageRect.left - containerRect.left);
    const sigY_PageRelative = this.sigPosY - (pageRect.top - containerRect.top);

    // Calculate the offset from the click point to the signature's page-relative top-left corner
    this.dragOffsetX = clientX - pageRect.left - sigX_PageRelative;
    this.dragOffsetY = clientY - pageRect.top - sigY_PageRelative;
  }

  startResize(event: MouseEvent | TouchEvent) {
    event.stopPropagation();
    event.preventDefault();
    this.resizing = true;

    let clientX = 0, clientY = 0;
    if (event instanceof MouseEvent) { clientX = event.clientX; clientY = event.clientY; }
    else if (event instanceof TouchEvent) { clientX = event.touches[0].clientX; clientY = event.touches[0].clientY; }

    this.resizeStartX = clientX;
    this.resizeStartY = clientY;
    this.startWidth = this.sigWidth;
    this.startHeight = this.sigHeight;
  }

  onDrag(event: MouseEvent | TouchEvent) {
    if (!this.dragging && !this.resizing) return;

    const pageElements = this.pdfContainer?.nativeElement.querySelectorAll('.page');
    const pageElement = pageElements![this.sigPage - 1] as HTMLElement;
    if (!pageElement) return;

    const pageRect = pageElement.getBoundingClientRect();
    const containerRect = this.pdfContainer!.nativeElement.getBoundingClientRect(); // CRITICAL: Get container boundaries

    let clientX = 0, clientY = 0;
    if (event instanceof MouseEvent) { clientX = event.clientX; clientY = event.clientY; }
    else if (event instanceof TouchEvent) { clientX = event.touches[0].clientX; clientY = event.touches[0].clientY; }

    if (this.dragging) {
        // 1. Calculate the new position relative to the page's top-left corner
        let newX_PageRelative = clientX - pageRect.left - this.dragOffsetX;
        let newY_PageRelative = clientY - pageRect.top - this.dragOffsetY;

        // 2. Apply page boundary checks (using the Page Relative position)
        const boundedX_PageRelative = Math.min(Math.max(newX_PageRelative, 0), pageRect.width - this.sigWidth);
        const boundedY_PageRelative = Math.min(Math.max(newY_PageRelative, 0), pageRect.height - this.sigHeight);

        // 3. Convert the bounded Page Relative position to the absolute position relative to the CONTAINER
        this.sigPosX = boundedX_PageRelative + (pageRect.left - containerRect.left); // Add page's offset from container left
        this.sigPosY = boundedY_PageRelative + (pageRect.top - containerRect.top);   // Add page's offset from container top

    } else if (this.resizing) {
        let deltaX = clientX - this.resizeStartX;
        let deltaY = clientY - this.resizeStartY;

        // Resizing boundary logic (needs to be updated to use the page bounds correctly)
        // Get the signature's current position relative to the page (to calculate max allowed size)
        const sigX_PageRelative = this.sigPosX - (pageRect.left - containerRect.left);
        const sigY_PageRelative = this.sigPosY - (pageRect.top - containerRect.top);

        const MIN_SIZE = 20;

        this.sigWidth = Math.min(
            Math.max(MIN_SIZE, this.startWidth + deltaX),
            pageRect.width - sigX_PageRelative // Right bound: page width - sig relative X
        );
        this.sigHeight = Math.min(
            Math.max(MIN_SIZE, this.startHeight + deltaY),
            pageRect.height - sigY_PageRelative // Bottom bound: page height - sig relative Y
        );
    }
  }

  stopDrag(event: MouseEvent | TouchEvent) {
    this.dragging = false;
    this.resizing = false;
  }

  async onPdfLoad(pdf: PDFDocumentProxy) {
    this.totalPages = pdf.numPages;
    this.pageNumbers = Array.from({ length: pdf.numPages }, (_, i) => i + 1);

    // center signature after load
    setTimeout(() => this.centerSignature(), 300);
  }

  async applySignature() {
    if (!this.pdfBytes || !this.signatureDataUrl) {
      return alert('Please draw or upload a signature!');
    }
  
    // Load PDF
    const pdfDoc = await PDFDocument.load(this.pdfBytes);
    const pages = pdfDoc.getPages();
    const page = pages[this.sigPage - 1];
  
    // Embed signature image
    const pngImage = await pdfDoc.embedPng(this.signatureDataUrl);
  
    // Get the corresponding page element in the viewer
    const pageElements = this.pdfContainer?.nativeElement.querySelectorAll('.page');
    const pageElement = pageElements![this.sigPage - 1] as HTMLElement;
    if (!pageElement) return alert('PDF page element not found!');
  
    // Get the page's actual rendered size and position
    const pageRect = pageElement.getBoundingClientRect();
    const containerRect = this.pdfContainer!.nativeElement.getBoundingClientRect();
  
    // Compute scale between PDF units and rendered pixels
    const scaleX = page.getWidth() / pageRect.width;
    const scaleY = page.getHeight() / pageRect.height;
  
    // Adjust for signature position relative to the page
    const x = (this.sigPosX - pageRect.left + containerRect.left) * scaleX;
    const y = page.getHeight() - ((this.sigPosY - pageRect.top + containerRect.top) + this.sigHeight) * scaleY;
  
    // Draw the signature
    page.drawImage(pngImage, {
      x,
      y,
      width: this.sigWidth * scaleX,
      height: this.sigHeight * scaleY,
    });
  
    // Save and download
    const signedPdfBytes = await pdfDoc.save();
    this.downloadPdf(signedPdfBytes);
  }
  

  downloadPdf(bytes: Uint8Array) {
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.file_name;
    a.click();
    URL.revokeObjectURL(url);
  }
}
