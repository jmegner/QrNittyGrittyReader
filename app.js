(function () {
  const fileInput = document.getElementById('image-input');
  const dropArea = document.getElementById('drop-area');
  const preview = document.getElementById('preview');
  const startCameraButton = document.getElementById('start-camera');
  const capturePhotoButton = document.getElementById('capture-photo');
  const stopCameraButton = document.getElementById('stop-camera');
  const listCamerasButton = document.getElementById('list-cameras');
  const cameraStreamEl = document.getElementById('camera-stream');
  const cameraCanvas = document.getElementById('camera-canvas');
  const qrOutputNG = document.getElementById('qr-output-ng');
  const qrOutputOriginal = document.getElementById('qr-output-original');
  const cameraListEl = document.getElementById('camera-list');

  let mediaStream = null;

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

  function renderQrResults(ng, original) {
    if (qrOutputNG) {
      try {
        qrOutputNG.textContent = ng ? JSON.stringify(ng, null, 2) : 'No QR code found in image.';
      } catch {
        qrOutputNG.textContent = 'Unable to stringify Nitty Gritty result.';
      }
    }
    if (qrOutputOriginal) {
      try {
        qrOutputOriginal.textContent = original ? JSON.stringify(original, null, 2) : 'No QR code found in image.';
      } catch {
        qrOutputOriginal.textContent = 'Unable to stringify Original result.';
      }
    }
  }

  function decodeFromCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    if (!ctx) { renderQrResults(null, null); return; }
    const width = canvas.width;
    const height = canvas.height;
    let imageData;
    try {
      imageData = ctx.getImageData(0, 0, width, height);
    } catch {
      renderQrResults(null, null);
      return;
    }
    const nittyDecoder = window.jsQRNittyGritty || window.jsQR;
    const originalDecoder = window.jsQROriginal || null;
    const options = { inversionAttempts: 'attemptBoth' };
    const ngResult = nittyDecoder ? nittyDecoder(imageData.data, width, height, options) : null;
    const origResult = originalDecoder ? originalDecoder(imageData.data, width, height, options) : null;
    renderQrResults(ngResult, origResult);
  }

  function decodeFromDataUrl(dataUrl) {
    const img = new Image();
    // To avoid taint issues when reading pixels from data URL, no crossOrigin needed
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        renderQrResult(null);
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      decodeFromCanvas(canvas);
    };
    img.onerror = () => renderQrResult(null);
    img.src = dataUrl;
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
    } catch (error) {
      preview.textContent = 'Unable to access the camera.';
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
    cameraCanvas.hidden = false;

    const dataUrl = cameraCanvas.toDataURL('image/png');
    setPreviewFromDataUrl(dataUrl, 'Captured image', 'Camera');

    // Use the drawn camera frame directly for decoding
    decodeFromCanvas(cameraCanvas);
  }

  function setupCameraControls() {
    startCameraButton.addEventListener('click', startCamera);
    capturePhotoButton.addEventListener('click', capturePhoto);
    stopCameraButton.addEventListener('click', stopCamera);
    if (listCamerasButton) {
      listCamerasButton.addEventListener('click', listCameras);
    }
  }

  function init() {
    setupFileInput();
    setupDragAndDrop();
    setupCameraControls();
  }

  document.addEventListener('DOMContentLoaded', init);

  async function listCameras() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      if (cameraListEl) cameraListEl.textContent = 'enumerateDevices not supported.';
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
      if (cameraListEl) cameraListEl.textContent = JSON.stringify(info, null, 2);
    } catch (err) {
      if (cameraListEl) cameraListEl.textContent = 'Failed to list cameras: ' + (err && err.message || String(err));
    }
  }
})();
