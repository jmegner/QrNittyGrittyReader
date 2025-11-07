(function () {
  const fileInput = document.getElementById('image-input');
  const dropArea = document.getElementById('drop-area');
  const preview = document.getElementById('preview');
  const startCameraButton = document.getElementById('start-camera');
  const capturePhotoButton = document.getElementById('capture-photo');
  const stopCameraButton = document.getElementById('stop-camera');
  const cameraStreamEl = document.getElementById('camera-stream');
  const cameraCanvas = document.getElementById('camera-canvas');

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
      setPreviewFromDataUrl(reader.result, file.name, originLabel);
    });
    reader.addEventListener('error', () => {
      preview.textContent = 'Unable to read the selected image file.';
    });
    reader.readAsDataURL(file);
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

  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      preview.textContent = 'Camera access is not supported on this browser.';
      return;
    }

    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ video: true });
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
  }

  function setupCameraControls() {
    startCameraButton.addEventListener('click', startCamera);
    capturePhotoButton.addEventListener('click', capturePhoto);
    stopCameraButton.addEventListener('click', stopCamera);
  }

  function init() {
    setupFileInput();
    setupDragAndDrop();
    setupCameraControls();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
