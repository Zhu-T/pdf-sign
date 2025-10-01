import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PdfSigner } from './pdf-signer';

describe('PdfSigner', () => {
  let component: PdfSigner;
  let fixture: ComponentFixture<PdfSigner>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PdfSigner]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PdfSigner);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
