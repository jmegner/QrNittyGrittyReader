# Agent Guidelines for QrNittyGrittyReader

Welcome! This project is a lightweight client-side QR code inspector. Most
changes involve HTML and vanilla JavaScript. Please keep these conventions in
mind while working anywhere in this repository:

1. **Entry point layout**
   - `index.html` defines the UI skeleton, camera controls, and DOM targets.
   - `app.js` wires browser APIs (camera, canvas, drag/drop) to the UI and hosts
     most orchestration logic.
2. **QR decoding libraries**
   - `jsQRNittyGritty.js` is a customized fork of `jsQR.js` that returns extra
     debugging metadata. Prefer working here when changing detection behavior.
   - `jsQR.js` contains the original upstream logic. Keep it untouched unless a
     sync/bugfix is explicitly required.
   - `zxing_v0-21-3.js` is a third-party fallback decoder. Avoid editing unless
     you understand ZXing internals.
3. **Code style**
   - Use modern ES6 syntax (const/let, arrow functions) but avoid introducing a
     build step—everything runs directly in the browser.
   - Favor descriptive variable names and inline comments when touching math-
     heavy QR routines (especially in `jsQRNittyGritty.js`).
If you add new directories, consider placing an `AGENTS.md` inside them with
more specific instructions.
