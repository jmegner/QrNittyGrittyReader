(function () {
  const fileInput = document.getElementById('image-input');
  const dropArea = document.getElementById('drop-area');
  const preview = document.getElementById('preview');
  const startCameraButton = document.getElementById('start-camera');
  const capturePhotoButton = document.getElementById('capture-photo');
  const stopCameraButton = document.getElementById('stop-camera');
  const startCameraScanButton = document.getElementById('start-camera-scan');
  const listCamerasButton = document.getElementById('list-cameras');
  const listCamerasFallbackLabel = 'list cameras';
  const cameraStreamEl = document.getElementById('camera-stream');
  const cameraCanvas = document.getElementById('camera-canvas');
  const qrOutputNG = document.getElementById('qr-output-ng');
  const qrOutputOriginal = document.getElementById('qr-output-original');
  const qrOutputZXing = document.getElementById('qr-output-zxing');
  const toggleNgButton = document.getElementById('toggle-ng');
  const toggleOriginalButton = document.getElementById('toggle-original');
  const toggleZXingButton = document.getElementById('toggle-zxing');
  const cameraListEl = document.getElementById('camera-list');
  const cameraSection = document.getElementById('camera-section');
  const cameraControls = document.getElementById('camera-controls');
  const copyNgBtn = document.getElementById('copy-ng');
  const copyOriginalBtn = document.getElementById('copy-original');
  const copyZxingBtn = document.getElementById('copy-zxing');
  const expandAllNgBtn = document.getElementById('expand-all-ng');
  const expand1NgBtn = document.getElementById('expand1-ng');
  const expandAllOriginalBtn = document.getElementById('expand-all-original');
  const expand1OriginalBtn = document.getElementById('expand1-original');
  const expandAllZxingBtn = document.getElementById('expand-all-zxing');
  const expand1ZxingBtn = document.getElementById('expand1-zxing');

  let mediaStream = null;
  let scanning = false;
  let scanRafId = null;
  let scanCanvas = null; // Offscreen canvas for scanning loop
  let cameraListDisplayToken = 0;

  function setPreviewFromDataUrl(dataUrl, description, sourceLabel) {
    preview.innerHTML = '';

    const figure = document.createElement('figure');
    figure.className = 'preview-figure';

    if (sourceLabel) {
      const caption = document.createElement('figcaption');
      caption.className = 'preview-source';
      caption.textContent = `Source: ${sourceLabel}`;
      figure.appendChild(caption);
    }

    const image = document.createElement('img');
    image.src = dataUrl;
    image.alt = description || 'Selected image preview';
    figure.appendChild(image);

    preview.appendChild(figure);

    // Kick off QR decode for this image
    decodeFromDataUrl(dataUrl);
  }

  // Set preview image without triggering decode (used for camera scan success snapshot)
  function setPreviewOnlyFromDataUrl(dataUrl, description, sourceLabel) {
    preview.innerHTML = '';

    const figure = document.createElement('figure');
    figure.className = 'preview-figure';

    if (sourceLabel) {
      const caption = document.createElement('figcaption');
      caption.className = 'preview-source';
      caption.textContent = `Source: ${sourceLabel}`;
      figure.appendChild(caption);
    }

    const image = document.createElement('img');
    image.src = dataUrl;
    image.alt = description || 'Selected image preview';
    figure.appendChild(image);

    preview.appendChild(figure);
  }

  function handleFile(file, originLabel) {
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      preview.textContent = 'The selected file is not an image.';
      return;
    }

    const reader = new FileReader();
    reader.addEventListener('load', () => {
      const resolvedOriginLabel =
        originLabel === 'File' && file.name ? `File '${file.name}'` : originLabel;
      setPreviewFromDataUrl(reader.result, file.name, resolvedOriginLabel);
    });
    reader.addEventListener('error', () => {
      preview.textContent = 'Unable to read the selected image file.';
    });
    reader.readAsDataURL(file);
  }

  let lastResults = { ng: null, original: null, zxing: null };

  function renderQrResults(ng, original, zxing) {
    const renderInto = (el, obj, emptyMsg, errorMsg) => {
      if (!el) return;
      // Clear previous content
      while (el.firstChild) el.removeChild(el.firstChild);
      if (!obj) {
        el.textContent = emptyMsg;
        return;
      }
      try {
        if (window.renderjson) {
          try { window.renderjson.set_show_to_level(1); } catch {}
          const node = window.renderjson(obj);
          el.appendChild(node);
        } else {
          el.textContent = JSON.stringify(obj, null, 2);
        }
      } catch {
        el.textContent = errorMsg;
      }
    };

    renderInto(qrOutputNG, ng, 'No QR code found in image.', 'Unable to render Nitty Gritty result.');
    if (copyNgBtn) copyNgBtn.hidden = !ng;
    if (expandAllNgBtn) expandAllNgBtn.hidden = !ng;
    if (expand1NgBtn) expand1NgBtn.hidden = !ng;
    renderInto(qrOutputOriginal, original, 'No QR code found in image.', 'Unable to render Original result.');
    if (copyOriginalBtn) copyOriginalBtn.hidden = !original;
    if (expandAllOriginalBtn) expandAllOriginalBtn.hidden = !original;
    if (expand1OriginalBtn) expand1OriginalBtn.hidden = !original;
    renderInto(qrOutputZXing, zxing, 'No QR code found in image.', 'Unable to render ZXing result.');
    if (copyZxingBtn) copyZxingBtn.hidden = !zxing;
    if (expandAllZxingBtn) expandAllZxingBtn.hidden = !zxing;
    if (expand1ZxingBtn) expand1ZxingBtn.hidden = !zxing;

    // Remember raw objects for copy-to-clipboard
    lastResults = { ng, original, zxing };
  }

  function prettyStringify(obj) {
    try {
      return JSON.stringify(obj, null, 2);
    } catch (e) {
      return '"[Unable to stringify JSON]"';
    }
  }

  async function copyTextToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {}
    // Fallback
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }

  function withCopyFeedback(btn, didCopy) {
    if (!btn) return;
    const original = btn.textContent;
    btn.textContent = didCopy ? '✅' : '❌';
    setTimeout(() => { btn.textContent = original; }, 900);
  }

  function setupCopyButtons() {
    const hook = (btn, getter) => {
      if (!btn) return;
      btn.addEventListener('click', async () => {
        const obj = getter();
        const text = obj !== undefined ? prettyStringify(obj) : 'null';
        const ok = await copyTextToClipboard(text);
        withCopyFeedback(btn, ok);
      });
    };
    hook(copyNgBtn, () => lastResults.ng);
    hook(copyOriginalBtn, () => lastResults.original);
    hook(copyZxingBtn, () => lastResults.zxing);
  }

  function rerenderSection(level, which) {
    if (!window.renderjson) return;
    const setLevel = (val) => { try { window.renderjson.set_show_to_level(val); } catch {} };
    const doRender = (el, obj, emptyMsg, errMsg) => {
      if (!el) return;
      while (el.firstChild) el.removeChild(el.firstChild);
      if (!obj) { el.textContent = emptyMsg; return; }
      try {
        setLevel(level);
        el.appendChild(window.renderjson(obj));
      } catch {
        el.textContent = errMsg;
      } finally {
        // Reset default for general rendering
        setLevel(1);
      }
    };
    if (which === 'ng') {
      doRender(qrOutputNG, lastResults.ng, 'No QR code found in image.', 'Unable to render Nitty Gritty result.');
    } else if (which === 'original') {
      doRender(qrOutputOriginal, lastResults.original, 'No QR code found in image.', 'Unable to render Original result.');
    } else if (which === 'zxing') {
      doRender(qrOutputZXing, lastResults.zxing, 'No QR code found in image.', 'Unable to render ZXing result.');
    }
  }

  function setupExpandButtons() {
    const hook = (btn, level, which) => {
      if (!btn) return;
      btn.addEventListener('click', () => rerenderSection(level, which));
    };
    hook(expandAllNgBtn, 'all', 'ng');
    hook(expand1NgBtn, 1, 'ng');
    hook(expandAllOriginalBtn, 'all', 'original');
    hook(expand1OriginalBtn, 1, 'original');
    hook(expandAllZxingBtn, 'all', 'zxing');
    hook(expand1ZxingBtn, 1, 'zxing');
  }

  function updateToggleLabel(button, isVisible, label) {
    if (!button) { return; }
    button.textContent = `${isVisible ? 'Hide' : 'Show'} ${label}`;
  }

  function setupToggle(button, target, label) {
    if (!button || !target) { return; }
    const setVisibility = (visible) => {
      target.hidden = !visible;
      updateToggleLabel(button, visible, label);
    };
    setVisibility(!target.hidden);
    button.addEventListener('click', () => {
      setVisibility(target.hidden);
    });
  }

  function decodeFromCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    if (!ctx) { return { ng: null, original: null }; }
    const width = canvas.width;
    const height = canvas.height;
    let imageData;
    try {
      imageData = ctx.getImageData(0, 0, width, height);
    } catch {
      return { ng: null, original: null };
    }
    const nittyDecoder = window.jsQRNittyGritty || window.jsQR;
    const originalDecoder = window.jsQROriginal || null;
    const options = { inversionAttempts: 'attemptBoth' };
    const ngResult = nittyDecoder ? nittyDecoder(imageData.data, width, height, options) : null;
    const origResult = originalDecoder ? originalDecoder(imageData.data, width, height, options) : null;
    return { ng: ngResult, original: origResult };
  }

  function decodeFromDataUrl(dataUrl) {
    const img = new Image();
    // To avoid taint issues when reading pixels from data URL, no crossOrigin needed
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { renderQrResults(null, null, null); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const { ng, original } = decodeFromCanvas(canvas);

      // Kick off ZXing asynchronously, render immediate jsQR results
      renderQrResults(ng, original, null);
      (async () => {
        let zxingResult = null;
        try {
          const ZXing = window.ZXingLib || window.ZXing || null;
          if (ZXing && ZXing.BrowserQRCodeReader) {
            if (!window.__qrReader) {
              window.__qrReader = new ZXing.BrowserQRCodeReader();
            }
            const reader = window.__qrReader;
            const result = await reader.decodeFromImage(img);
            zxingResult = normalizeZXingResult(result);
          }
        } catch (e) {
          zxingResult = null;
        }
        renderQrResults(ng, original, zxingResult);
      })();
    };
    img.onerror = () => renderQrResults(null, null, null);
    img.src = dataUrl;
  }

  function normalizeZXingResult(result) {
    if (!result) return null;
    try {
      const plain = {
        text: result.text ?? (result.getText ? result.getText() : undefined),
        rawBytes: result.rawBytes ? Array.from(result.rawBytes) : (result.getRawBytes ? Array.from(result.getRawBytes() || []) : undefined),
        numBits: result.numBits ?? (result.getNumBits ? result.getNumBits() : undefined),
        resultPoints: result.resultPoints
          ? result.resultPoints.map(p => ({ x: p.x, y: p.y }))
          : (result.getResultPoints ? (result.getResultPoints() || []).map(p => ({ x: p.getX ? p.getX() : p.x, y: p.getY ? p.getY() : p.y })) : undefined),
        barcodeFormat: result.barcodeFormat ?? (result.getBarcodeFormat ? String(result.getBarcodeFormat()) : undefined),
        resultMetadata: result.resultMetadata ?? (result.getResultMetadata ? result.getResultMetadata() : undefined),
        timestamp: result.timestamp ?? (result.getTimestamp ? result.getTimestamp() : undefined),
      };
      return plain;
    } catch {
      return { error: 'Unable to normalize ZXing Result' };
    }
  }

  function preventDefaults(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function highlightDropArea() {
    dropArea.classList.add('dragover');
  }

  function unhighlightDropArea() {
    dropArea.classList.remove('dragover');
  }

  function setupFileInput() {
    if (!fileInput) {
      return;
    }

    fileInput.addEventListener('change', (event) => {
      const [file] = event.target.files || [];
      handleFile(file, 'File');
    });
  }

  function setupDragAndDrop() {
    const events = ['dragenter', 'dragover', 'dragleave', 'drop'];
    events.forEach((eventName) => {
      dropArea.addEventListener(eventName, preventDefaults);
    });

    ['dragenter', 'dragover'].forEach((eventName) => {
      dropArea.addEventListener(eventName, highlightDropArea);
    });

    ['dragleave', 'drop'].forEach((eventName) => {
      dropArea.addEventListener(eventName, unhighlightDropArea);
    });

    dropArea.addEventListener('drop', (event) => {
      const files = event.dataTransfer.files;
      if (files && files.length > 0) {
        handleFile(files[0], 'File');
        return;
      }

      const items = event.dataTransfer.items;
      if (items) {
        for (const item of items) {
          if (item.kind === 'file') {
            const file = item.getAsFile();
            if (file) {
              handleFile(file, 'File');
              break;
            }
          }
        }
      }
    });

    dropArea.addEventListener('paste', (event) => {
      const items = event.clipboardData?.items;
      if (!items) {
        preview.textContent = 'No clipboard items found.';
        return;
      }

      let imageFile = null;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          imageFile = item.getAsFile();
          break;
        }
      }

      if (imageFile) {
        handleFile(imageFile, 'Clipboard');
        return;
      }

      preview.textContent = 'Clipboard does not contain an image.';
    });
  }

  function stopCamera() {
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }
    if (typeof cameraStreamEl.pause === 'function') {
      cameraStreamEl.pause();
    }
    cameraStreamEl.srcObject = null;
    cameraStreamEl.removeAttribute('src');
    if (typeof cameraStreamEl.load === 'function') {
      cameraStreamEl.load();
    }
    cameraStreamEl.hidden = true;
    cameraCanvas.hidden = true;
    const context = cameraCanvas.getContext('2d');
    if (context) {
      context.clearRect(0, 0, cameraCanvas.width, cameraCanvas.height);
    }
    capturePhotoButton.disabled = true;
    stopCameraButton.disabled = true;
    // Scanning-related UI
    scanning = false;
    if (scanRafId) {
      cancelAnimationFrame(scanRafId);
      scanRafId = null;
    }
    if (startCameraScanButton) startCameraScanButton.disabled = false;
  }

  async function getRearCameraStream() {
    // Try progressively stronger hints for the rear (environment) camera
    const candidates = [
      { video: { facingMode: { exact: 'environment' } } },
      { video: { facingMode: { ideal: 'environment' } } },
      { video: true },
    ];
    let lastError = null;
    for (const constraints of candidates) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error('Unable to acquire camera');
  }

  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      preview.textContent = 'Camera access is not supported on this browser.';
      return;
    }

    try {
      mediaStream = await getRearCameraStream();
      cameraStreamEl.srcObject = mediaStream;
      cameraStreamEl.hidden = false;
      if (typeof cameraStreamEl.play === 'function') {
        const playPromise = cameraStreamEl.play();
        if (playPromise && typeof playPromise.catch === 'function') {
          playPromise.catch(() => {});
        }
      }
      cameraCanvas.hidden = true;
      capturePhotoButton.disabled = false;
      stopCameraButton.disabled = false;
      if (startCameraScanButton) startCameraScanButton.disabled = false;
    } catch (error) {
      preview.textContent = 'Unable to access the camera.';
    }
  }

  function scrollCameraControlsIntoView() {
    const targetEl = cameraControls || cameraSection;
    if (!targetEl) {
      return;
    }
    try {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {
      const rect = targetEl.getBoundingClientRect();
      window.scrollTo(0, window.scrollY + rect.top);
    }
  }

  function capturePhoto() {
    if (!mediaStream) {
      preview.textContent = 'Start the camera before capturing a photo.';
      return;
    }

    const trackSettings = mediaStream.getVideoTracks()[0]?.getSettings?.() || {};
    const width = cameraStreamEl.videoWidth || trackSettings.width || 640;
    const height = cameraStreamEl.videoHeight || trackSettings.height || 480;

    cameraCanvas.width = width;
    cameraCanvas.height = height;
    const context = cameraCanvas.getContext('2d');
    context.drawImage(cameraStreamEl, 0, 0, width, height);

    const dataUrl = cameraCanvas.toDataURL('image/png');
    setPreviewFromDataUrl(dataUrl, 'Captured image', 'Camera');

    // After capturing a still, stop the camera stream so the snapshot only appears
    // in the preview section and we release hardware resources immediately.
    stopCamera();
  }

  function setupCameraControls() {
    startCameraButton.addEventListener('click', () => {
      scrollCameraControlsIntoView();
      startCamera();
    });
    capturePhotoButton.addEventListener('click', capturePhoto);
    stopCameraButton.addEventListener('click', stopCamera);
    if (startCameraScanButton) {
      startCameraScanButton.addEventListener('click', () => {
        scrollCameraControlsIntoView();
        startCameraScan();
      });
    }
    if (listCamerasButton) {
      listCamerasButton.addEventListener('click', handleListCamerasButtonClick);
    }
  }

  function setupResultToggles() {
    setupToggle(toggleNgButton, qrOutputNG, 'Nitty Gritty');
    setupToggle(toggleOriginalButton, qrOutputOriginal, 'Original');
    setupToggle(toggleZXingButton, qrOutputZXing, 'ZXing');
  }

  function init() {
    setupFileInput();
    setupDragAndDrop();
    setupCameraControls();
    setupResultToggles();
    setupCopyButtons();
    setupExpandButtons();
  }

  document.addEventListener('DOMContentLoaded', init);

  function rememberListCamerasOriginalLabel() {
    if (!listCamerasButton) {
      return listCamerasFallbackLabel;
    }
    if (!listCamerasButton.dataset.originalLabel) {
      const label = (listCamerasButton.textContent || '').trim() || listCamerasFallbackLabel;
      listCamerasButton.dataset.originalLabel = label;
    }
    return listCamerasButton.dataset.originalLabel;
  }

  function setListCamerasButtonToClear() {
    if (!listCamerasButton) {
      return;
    }
    rememberListCamerasOriginalLabel();
    listCamerasButton.textContent = 'clear list';
    listCamerasButton.dataset.listState = 'showing';
  }

  function resetListCamerasButton() {
    if (!listCamerasButton) {
      return;
    }
    const originalLabel = rememberListCamerasOriginalLabel();
    listCamerasButton.textContent = originalLabel;
    delete listCamerasButton.dataset.listState;
  }

  function clearCameraListDisplay() {
    if (cameraListEl) {
      cameraListEl.textContent = '';
    }
  }

  function handleListCamerasButtonClick() {
    if (!listCamerasButton) {
      return;
    }
    if (listCamerasButton.dataset.listState === 'showing') {
      cameraListDisplayToken += 1;
      clearCameraListDisplay();
      resetListCamerasButton();
      return;
    }
    setListCamerasButtonToClear();
    const requestToken = ++cameraListDisplayToken;
    listCameras(requestToken);
  }

  async function listCameras(requestToken = cameraListDisplayToken) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      if (cameraListEl && requestToken === cameraListDisplayToken) {
        cameraListEl.textContent = 'enumerateDevices not supported.';
      }
      return;
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter(d => d.kind === 'videoinput');
      const info = {
        now: new Date().toISOString(),
        videoInputCount: videoInputs.length,
        videoInputs: videoInputs.map((d, i) => ({
          index: i,
          kind: d.kind,
          deviceId: d.deviceId,
          label: d.label || '(label hidden - start camera to reveal)',
          groupId: d.groupId,
        })),
      };
      // If we have an active track, include current settings/capabilities
      try {
        const track = mediaStream?.getVideoTracks?.()[0];
        if (track) {
          const settings = track.getSettings?.() || {};
          let capabilities = {};
          try { capabilities = track.getCapabilities?.() || {}; } catch {}
          info.activeTrack = {
            label: track.label,
            readyState: track.readyState,
            enabled: track.enabled,
            muted: track.muted,
            settings,
            capabilities,
          };
        }
      } catch {}
      if (cameraListEl && requestToken === cameraListDisplayToken) {
        cameraListEl.textContent = JSON.stringify(info, null, 2);
      }
    } catch (err) {
      if (cameraListEl && requestToken === cameraListDisplayToken) {
        cameraListEl.textContent = 'Failed to list cameras: ' + (err && err.message || String(err));
      }
    }
  }

  // Camera Scan Mode
  async function ensureCameraReady() {
    if (!mediaStream) {
      await startCamera();
    }
    // Wait for video to have dimensions
    if (cameraStreamEl.readyState < 2 || !cameraStreamEl.videoWidth) {
      await new Promise((resolve) => {
        const onLoaded = () => {
          cameraStreamEl.removeEventListener('loadedmetadata', onLoaded);
          cameraStreamEl.removeEventListener('loadeddata', onLoaded);
          resolve();
        };
        cameraStreamEl.addEventListener('loadedmetadata', onLoaded, { once: true });
        cameraStreamEl.addEventListener('loadeddata', onLoaded, { once: true });
      });
    }
  }

  function getScanCanvas() {
    if (scanCanvas) return scanCanvas;
    // Prefer OffscreenCanvas if available
    try {
      if (typeof OffscreenCanvas !== 'undefined') {
        scanCanvas = new OffscreenCanvas(1, 1);
        return scanCanvas;
      }
    } catch {}
    // Fallback to hidden in-DOM canvas
    const c = document.createElement('canvas');
    c.width = 1; c.height = 1; c.style.display = 'none';
    document.body.appendChild(c);
    scanCanvas = c;
    return scanCanvas;
  }

  function scanFrame() {
    if (!scanning || !mediaStream) { return; }
    const width = cameraStreamEl.videoWidth || 640;
    const height = cameraStreamEl.videoHeight || 480;
    const c = getScanCanvas();
    // Set canvas size
    if (c instanceof HTMLCanvasElement) {
      if (c.width !== width) c.width = width;
      if (c.height !== height) c.height = height;
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.drawImage(cameraStreamEl, 0, 0, width, height);
        try {
          const imageData = ctx.getImageData(0, 0, width, height);
          const nittyDecoder = window.jsQRNittyGritty || window.jsQR;
          const options = { inversionAttempts: 'attemptBoth' };
          const ngResult = nittyDecoder ? nittyDecoder(imageData.data, width, height, options) : null;
          if (ngResult) {
            let origResult = null;
            try {
              const originalDecoder = window.jsQROriginal || null;
              if (originalDecoder) {
                origResult = originalDecoder(imageData.data, width, height, options);
              }
            } catch {}

            // Update Preview with the successful frame and kick off ZXing
            let dataUrl = null;
            try {
              cameraCanvas.width = width;
              cameraCanvas.height = height;
              const snapCtx = cameraCanvas.getContext('2d');
              if (snapCtx) {
                snapCtx.drawImage(cameraStreamEl, 0, 0, width, height);
                dataUrl = cameraCanvas.toDataURL('image/png');
                setPreviewOnlyFromDataUrl(dataUrl, 'Decoded frame', 'Camera Scan');
              }
            } catch {}

            // Render immediate ng + original
            renderQrResults(ngResult, origResult, null);

            // Start ZXing decode asynchronously using the snapshot
            (async () => {
              let zxingResult = null;
              try {
                if (dataUrl) {
                  const ZXing = window.ZXingLib || window.ZXing || null;
                  if (ZXing && ZXing.BrowserQRCodeReader) {
                    if (!window.__qrReader) {
                      window.__qrReader = new ZXing.BrowserQRCodeReader();
                    }
                    const reader = window.__qrReader;
                    // Use Image element to decode the snapshot
                    const img = new Image();
                    await new Promise((resolve, reject) => {
                      img.onload = resolve;
                      img.onerror = reject;
                      img.src = dataUrl;
                    });
                    const result = await reader.decodeFromImage(img);
                    zxingResult = normalizeZXingResult(result);
                  }
                }
              } catch {}
              renderQrResults(ngResult, origResult, zxingResult);
            })();

            // Stop scanning and camera on success
            stopCamera();
            scanning = false;
            return;
          }
        } catch {}
      }
    } else if (typeof c.getContext === 'function') { // OffscreenCanvas
      c.width = width; c.height = height;
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.drawImage(cameraStreamEl, 0, 0, width, height);
        try {
          const imageData = ctx.getImageData(0, 0, width, height);
          const nittyDecoder = window.jsQRNittyGritty || window.jsQR;
          const options = { inversionAttempts: 'attemptBoth' };
          const ngResult = nittyDecoder ? nittyDecoder(imageData.data, width, height, options) : null;
          if (ngResult) {
            let origResult = null;
            try {
              const originalDecoder = window.jsQROriginal || null;
              if (originalDecoder) {
                origResult = originalDecoder(imageData.data, width, height, options);
              }
            } catch {}

            let dataUrl = null;
            try {
              cameraCanvas.width = width;
              cameraCanvas.height = height;
              const snapCtx = cameraCanvas.getContext('2d');
              if (snapCtx) {
                snapCtx.drawImage(cameraStreamEl, 0, 0, width, height);
                dataUrl = cameraCanvas.toDataURL('image/png');
                setPreviewOnlyFromDataUrl(dataUrl, 'Decoded frame', 'Camera Scan');
              }
            } catch {}

            renderQrResults(ngResult, origResult, null);

            (async () => {
              let zxingResult = null;
              try {
                if (dataUrl) {
                  const ZXing = window.ZXingLib || window.ZXing || null;
                  if (ZXing && ZXing.BrowserQRCodeReader) {
                    if (!window.__qrReader) {
                      window.__qrReader = new ZXing.BrowserQRCodeReader();
                    }
                    const reader = window.__qrReader;
                    const img = new Image();
                    await new Promise((resolve, reject) => {
                      img.onload = resolve;
                      img.onerror = reject;
                      img.src = dataUrl;
                    });
                    const result = await reader.decodeFromImage(img);
                    zxingResult = normalizeZXingResult(result);
                  }
                }
              } catch {}
              renderQrResults(ngResult, origResult, zxingResult);
            })();

            stopCamera();
            scanning = false;
            return;
          }
        } catch {}
      }
    }
    scanRafId = requestAnimationFrame(scanFrame);
  }

  async function startCameraScan() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      preview.textContent = 'Camera access is not supported on this browser.';
      return;
    }
    if (scanning) return;
    try {
      await ensureCameraReady();
      scanning = true;
      if (startCameraScanButton) startCameraScanButton.disabled = true;
      if (stopCameraButton) stopCameraButton.disabled = false;
      // While scanning, disable capture to reduce confusion
      capturePhotoButton.disabled = true;
      scanRafId = requestAnimationFrame(scanFrame);
    } catch (e) {
      preview.textContent = 'Unable to start camera scan.';
    }
  }
})();
