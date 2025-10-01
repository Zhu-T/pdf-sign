import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PdfViewerModule } from 'ng2-pdf-viewer';

@NgModule({
  imports: [CommonModule, PdfViewerModule],
  exports: [CommonModule, PdfViewerModule], // re-export so others can use
})
export class SharedModule {}