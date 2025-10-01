import { Component } from '@angular/core';
import { PdfSigner } from './pdf-signer/pdf-signer';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [PdfSigner],   // still a standalone component
  template: `<app-pdf-signer></app-pdf-signer>`,
})
export class AppComponent {}