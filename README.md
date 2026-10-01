# PDF Sign

Fill out and sign PDFs in the browser, DocuSign-style. Nothing is uploaded: the PDF is opened, edited and saved entirely on your machine.

## Features

- **Open** a PDF with the file picker or by dropping it onto the window.
- **Fields**: pick a field from the sidebar, then click anywhere on any page to place it.
  - **Signature** and **Initials**: adopt them once by typing your name (four script styles), drawing (black or blue ink) or uploading an image (white backgrounds are removed). "Change" swaps every placed copy.
  - **Full name**, **Date signed** (prefilled with today's date) and **Text**: multi-line text that wraps and grows as you type, with adjustable font size.
  - **Checkbox**: click to toggle.
- **Edit**: drag to move, use the corner handle to resize, "All pages" to copy a field to the same spot on every page (handy for initials), and Delete to remove one.
- **Keyboard**: arrow keys nudge the selected field (Shift for bigger steps), Delete removes it, Ctrl/Cmd+Z undoes, Esc cancels.
- **Zoom** in and out, or click the percentage to fit the page width.
- **Download** writes the fields into the PDF (flattened), keeping the original file name. Rotated pages and non-Latin text are handled.

## Development

```bash
npm install
npm start          # http://localhost:4200
npm run build
npm test
```

Built with Angular, [pdf.js](https://mozilla.github.io/pdf.js/) for rendering, [pdf-lib](https://pdf-lib.js.org/) for writing the PDF and [signature_pad](https://github.com/szimek/signature_pad) for drawing.

Code layout (`src/app/pdf-signer/`):

| File | Purpose |
| --- | --- |
| `pdf-signer.*` | Main screen: page rendering, placing and editing fields, download |
| `signature-dialog/` | "Adopt your signature" dialog (type / draw / upload) |
| `fields.ts` | Field model, default sizes, shared text metrics |
| `pdf-export.ts` | Stamps fields onto the PDF with pdf-lib |
