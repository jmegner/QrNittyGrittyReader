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
  const ngBase64ListEl = document.getElementById('ng-base64-list');
  const ngUuidListEl = document.getElementById('ng-uuids');
  const qrOutputOriginal = document.getElementById('qr-output-original');
  const qrOutputZXing = document.getElementById('qr-output-zxing');
  const ngLinksEl = document.getElementById('ng-links');
  const originalLinksEl = document.getElementById('original-links');
  const zxingLinksEl = document.getElementById('zxing-links');
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
    const decodedBase64Entries = updateNgBase64List(ng);
    const { count: ngLinkCount, decodedBase64Urls } = updateLinksDisplay(ngLinksEl, ng && typeof ng.data === 'string' ? ng.data : '');
    updateNgUuidList(ng, decodedBase64Entries, decodedBase64Urls);
    if (ngLinksEl) ngLinksEl.hidden = (ngLinkCount === 0) || !!qrOutputNG.hidden;
    renderInto(qrOutputOriginal, original, 'No QR code found in image.', 'Unable to render Original result.');
    if (copyOriginalBtn) copyOriginalBtn.hidden = !original;
    if (expandAllOriginalBtn) expandAllOriginalBtn.hidden = !original;
    if (expand1OriginalBtn) expand1OriginalBtn.hidden = !original;
    const { count: originalLinkCount } = updateLinksDisplay(originalLinksEl, original && typeof original.data === 'string' ? original.data : '');
    if (originalLinksEl) originalLinksEl.hidden = (originalLinkCount === 0) || !!qrOutputOriginal.hidden;
    renderInto(qrOutputZXing, zxing, 'No QR code found in image.', 'Unable to render ZXing result.');
    if (copyZxingBtn) copyZxingBtn.hidden = !zxing;
    if (expandAllZxingBtn) expandAllZxingBtn.hidden = !zxing;
    if (expand1ZxingBtn) expand1ZxingBtn.hidden = !zxing;
    const { count: zxingLinkCount } = updateLinksDisplay(zxingLinksEl, zxing && typeof zxing.text === 'string' ? zxing.text : '');
    if (zxingLinksEl) zxingLinksEl.hidden = (zxingLinkCount === 0) || !!qrOutputZXing.hidden;

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
      // Ensure section is visible when expanding
      el.hidden = false;
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
      if (ngLinksEl && ngLinksEl.childNodes.length) ngLinksEl.hidden = false;
      if (ngBase64ListEl && ngBase64ListEl.childNodes.length) ngBase64ListEl.hidden = false;
      updateToggleLabel && updateToggleLabel(toggleNgButton, true, 'Nitty Gritty');
    } else if (which === 'original') {
      doRender(qrOutputOriginal, lastResults.original, 'No QR code found in image.', 'Unable to render Original result.');
      if (originalLinksEl && originalLinksEl.childNodes.length) originalLinksEl.hidden = false;
      updateToggleLabel && updateToggleLabel(toggleOriginalButton, true, 'Original');
    } else if (which === 'zxing') {
      doRender(qrOutputZXing, lastResults.zxing, 'No QR code found in image.', 'Unable to render ZXing result.');
      if (zxingLinksEl && zxingLinksEl.childNodes.length) zxingLinksEl.hidden = false;
      updateToggleLabel && updateToggleLabel(toggleZXingButton, true, 'ZXing');
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

  function extractLinks(text) {
    if (typeof text !== 'string' || !text) return [];
    const regex = /\b(?:[a-z][a-z0-9+.-]*:\/\/|[a-z][a-z0-9+.-]*:|www\.)[^\s<>'"()]+/gi;
    const results = [];
    let m;
    while ((m = regex.exec(text)) !== null) {
      let url = m[0];
      url = url.replace(/[),.;!?]+$/g, '');
      if (!url) continue;
      const href = url.startsWith('www.') ? `https://${url}` : url;
      if (!results.some(x => x.url === url)) {
        results.push({ url, href });
      }
    }
    return results;
  }

  function updateLinksDisplay(container, text) {
    const decodedBase64Urls = [];
    if (!container) return { count: 0, decodedBase64Urls };
    container.innerHTML = '';
    const links = extractLinks(text);
    if (!links.length) {
      container.hidden = true;
      return { count: 0, decodedBase64Urls };
    }
    const header = document.createElement('div');
    header.textContent = `Links found: ${links.length}`;
    container.appendChild(header);
    const list = document.createElement('ul');
    links.forEach(({ url, href }) => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = url;
      li.appendChild(a);

      if (/%[0-9a-fA-F]{2}/.test(url)) {
        const decodedDisplay = document.createElement('div');
        decodedDisplay.append('Percent-decoded: ');
        decodedDisplay.appendChild(buildHighlightedPercentDecoded(url));
        li.appendChild(decodedDisplay);
      }

      const postDomain = (() => {
        try {
          const parsed = new URL(href);
          return `${parsed.pathname || ''}${parsed.search || ''}${parsed.hash || ''}`;
        } catch {
          return '';
        }
      })();

      if (postDomain) {
        const decodedPostDomain = safeDecodeUriComponent(postDomain);
        const b64Items = findBase64Substrings(decodedPostDomain, 12, 'url');
        if (b64Items.length) {
          const decodedList = document.createElement('ul');
          decodedList.style.marginTop = '4px';
          decodedList.style.marginBottom = '0';

          b64Items.forEach(({ b64 }, idx) => {
            const decoded = base64ToUtf8(b64);
            if (decoded !== null) {
              decodedBase64Urls.push({ decoded, source: `Link ${url} base64url #${idx + 1}` });
            }
            const item = document.createElement('li');

            const label = document.createElement('div');
            label.innerHTML = `<strong>Base64url #${idx + 1}</strong>`;
            item.appendChild(label);

            const original = document.createElement('div');
            original.textContent = `Original: ${b64}`;
            item.appendChild(original);

            const decodedText = document.createElement('div');
            decodedText.textContent = `Decoded: ${decoded !== null ? decoded : '[binary data]'}`;
            item.appendChild(decodedText);

            decodedList.appendChild(item);
          });

          const decodedHeader = document.createElement('div');
          decodedHeader.textContent = `Base64url strings in link: ${b64Items.length}`;
          li.appendChild(decodedHeader);
          li.appendChild(decodedList);
        }
      }

      list.appendChild(li);
    });
    container.appendChild(list);
    return { count: links.length, decodedBase64Urls };
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeBase64(s) {
    if (!s) return '';
    let t = String(s).replace(/\s+/g, '');
    t = t.replace(/-/g, '+').replace(/_/g, '/');
    const mod = t.length % 4;
    if (mod === 1) {
      return t; // invalid length; atob will throw
    }
    if (mod > 0) {
      t = t.padEnd(t.length + (4 - mod), '=');
    }
    return t;
  }

  function isDecodableBase64(s) {
    try {
      const normalized = normalizeBase64(s);
      void atob(normalized);
      return true;
    } catch {
      return false;
    }
  }

  function findBase64Substrings(str, minLen = 12, variant = 'either') {
    if (typeof str !== 'string' || !str) return [];

    const buildRe = (alphabet, allowPadding) => new RegExp(`[${alphabet}]{${minLen},}${allowPadding ? '(?:==|=)?' : ''}`, 'g');
    const variants = variant === 'standard'
      ? [buildRe('A-Za-z0-9+/', true)]
      : variant === 'url'
        ? [buildRe('A-Za-z0-9_-', false)]
        : [buildRe('A-Za-z0-9+/', true), buildRe('A-Za-z0-9_-', false)];

    const out = [];
    variants.forEach((re) => {
      let m;
      while ((m = re.exec(str)) !== null) {
        const b64 = m[0];
        if (isDecodableBase64(b64)) {
          out.push({ b64, index: m.index });
        }
      }
    });

    const sorted = out.sort((a, b) => {
      if (a.index === b.index) return b.b64.length - a.b64.length;
      return a.index - b.index;
    });

    const filtered = [];
    sorted.forEach((item) => {
      const end = item.index + item.b64.length;
      const overlaps = filtered.some(({ index, b64 }) => {
        const prevEnd = index + b64.length;
        return item.index < prevEnd && end > index;
      });

      if (!overlaps) {
        filtered.push(item);
      }
    });

    return filtered;
  }

  function safeDecodeUriComponent(value) {
    if (typeof value !== 'string' || !value) return value || '';
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  function safeDecodeUri(value) {
    if (typeof value !== 'string' || !value) return value || '';
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  function buildHighlightedPercentDecoded(original) {
    const container = document.createElement('span');
    if (typeof original !== 'string' || !original) return container;

    const percentRun = /(?:%[0-9a-fA-F]{2})+/g;
    let lastIndex = 0;
    let match;

    while ((match = percentRun.exec(original)) !== null) {
      if (match.index > lastIndex) {
        container.appendChild(document.createTextNode(original.slice(lastIndex, match.index)));
      }

      const encoded = match[0];
      const decoded = decodePercentRun(encoded);
      if (decoded === null) {
        container.appendChild(document.createTextNode(encoded));
      } else {
        const highlight = document.createElement('span');
        highlight.className = 'percent-decoded-highlight';
        highlight.textContent = decoded;
        container.appendChild(highlight);
      }

      lastIndex = match.index + encoded.length;
    }

    if (lastIndex < original.length) {
      container.appendChild(document.createTextNode(original.slice(lastIndex)));
    }

    return container;
  }

  function decodePercentRun(segment) {
    try {
      return decodeURIComponent(segment);
    } catch {
      return null;
    }
  }

  function base64ToUtf8(b64) {
    try {
      const normalized = normalizeBase64(b64);
      const bin = atob(normalized);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const td = new TextDecoder('utf-8', { fatal: false });
      return td.decode(bytes);
    } catch {
      return null;
    }
  }

  function updateNgBase64List(ng) {
    if (!ngBase64ListEl) return [];
    const decodedEntries = [];
    try {
      ngBase64ListEl.innerHTML = '';
      if (!ng || typeof ng.data !== 'string') {
        ngBase64ListEl.hidden = true;
        return decodedEntries;
      }
      const items = findBase64Substrings(ng.data, 12);
      if (!items.length) {
        ngBase64ListEl.hidden = true;
        return decodedEntries;
      }
      ngBase64ListEl.hidden = false;

      const summary = document.createElement('div');
      summary.textContent = `Base64 strings found (min length 12): ${items.length}`;
      ngBase64ListEl.appendChild(summary);

      items.forEach(({ b64, index }, idx) => {
        const wrap = document.createElement('div');
        wrap.className = 'b64-item';

        const title = document.createElement('div');
        title.textContent = `#${idx + 1}`;
        wrap.appendChild(title);

        const meta = document.createElement('div');
        meta.textContent = `Length: ${b64.length}, Offset: ${index}`;
        wrap.appendChild(meta);

        const base64Line = document.createElement('div');
        const base64Label = document.createElement('span');
        base64Label.textContent = 'Base64: ';
        const base64Text = document.createElement('span');
        base64Text.textContent = b64;
        base64Line.appendChild(base64Label);
        base64Line.appendChild(base64Text);
        wrap.appendChild(base64Line);

        const decoded = base64ToUtf8(b64);
        if (decoded !== null) {
          decodedEntries.push({ decoded, source: `Decoded base64 #${idx + 1} (offset ${index})` });
        }
        const block = document.createElement('div');
        block.className = 'decoded-block';
        const header = document.createElement('div');
        header.className = 'decoded-header';
        const strong = document.createElement('strong');
        strong.textContent = 'Decoded';
        header.appendChild(strong);
        if (decoded !== null) {
          const copyBtn = document.createElement('button');
          copyBtn.type = 'button';
          copyBtn.title = 'Copy decoded';
          copyBtn.ariaLabel = 'Copy decoded';
          copyBtn.textContent = '📋';
          copyBtn.addEventListener('click', async () => {
            const ok = await copyTextToClipboard(decoded);
            withCopyFeedback(copyBtn, ok);
          });
          header.appendChild(copyBtn);
        }
        block.appendChild(header);

        const decodedText = document.createElement('div');
        decodedText.className = 'decoded-text';
        decodedText.textContent = decoded !== null ? decoded : '[binary data]';
        block.appendChild(decodedText);

        wrap.appendChild(block);
        ngBase64ListEl.appendChild(wrap);
      });
      return decodedEntries;
    } catch {
      ngBase64ListEl.hidden = true;
      ngBase64ListEl.textContent = '';
      return decodedEntries;
    }
  }

  const UUID_EPOCH_DIFF_100NS = 122192928000000000n; // Offset from Gregorian epoch to Unix epoch

  function describeVariant(variantChar) {
    const n = parseInt(variantChar, 16);
    if (Number.isNaN(n)) return 'Unknown variant';
    if (n <= 7) return 'Variant 0 (NCS/reserved)';
    if (n <= 0xb) return 'Variant 1 (RFC 4122)';
    if (n <= 0xd) return 'Variant 2 (Microsoft)';
    return 'Variant 3 (future/reserved)';
  }

  function macFromNode(nodeHex) {
    if (!nodeHex || !/^[0-9a-fA-F]{12}$/.test(nodeHex)) return null;
    return nodeHex.match(/.{2}/g).join(':');
  }

  function buildTimestampFrom100ns(uuidTimestamp) {
    if (typeof uuidTimestamp !== 'bigint') return null;
    const unix100ns = uuidTimestamp - UUID_EPOCH_DIFF_100NS;
    if (unix100ns < 0) return null;
    const ms = Number(unix100ns / 10000n);
    if (!Number.isFinite(ms)) return null;
    try {
      return { iso: new Date(ms).toISOString(), unixMillis: ms };
    } catch {
      return null;
    }
  }

  function parseUuidDetails(uuid) {
    const details = {
      uuid,
      version: null,
      variant: 'Unknown variant',
      timestamp: null,
      macAddress: null,
      clockSequence: null,
      randomPart: null,
      notes: [],
    };

    if (typeof uuid !== 'string') return details;
    const cleaned = uuid.toLowerCase();
    const parts = cleaned.split('-');
    if (parts.length !== 5) return details;

    const [timeLow, timeMid, timeHiVer, clockSeq, node] = parts;
    const versionNibble = timeHiVer && timeHiVer[0];
    details.version = /[0-9a-f]/.test(versionNibble) ? parseInt(versionNibble, 16) : null;
    details.variant = describeVariant(clockSeq && clockSeq[0]);
    const nodeHex = node || '';
    const macAddr = macFromNode(nodeHex);
    const clockSeqHi = clockSeq ? parseInt(clockSeq.slice(0, 2), 16) : NaN;
    const clockSeqLow = clockSeq ? parseInt(clockSeq.slice(2), 16) : NaN;
    const clockSeqValue = (!Number.isNaN(clockSeqHi) && !Number.isNaN(clockSeqLow))
      ? ((clockSeqHi & 0x3f) << 8) | clockSeqLow
      : null;

    switch (details.version) {
      case 1: {
        try {
          const ts100ns = ((BigInt(`0x${timeHiVer}`) & 0x0fffn) << 48n)
            | (BigInt(`0x${timeMid}`) << 32n)
            | BigInt(`0x${timeLow}`);
          details.timestamp = buildTimestampFrom100ns(ts100ns);
        } catch {
          details.notes.push('Unable to interpret timestamp for v1 UUID');
        }
        details.clockSequence = clockSeqValue;
        details.macAddress = macAddr;
        break;
      }
      case 2: {
        details.notes.push('Version 2 UUIDs store POSIX IDs instead of timestamps; timestamp is not recoverable.');
        details.clockSequence = clockSeqValue;
        details.macAddress = macAddr;
        break;
      }
      case 3:
      case 5: {
        const hashBits = `${timeLow}${timeMid}${timeHiVer.slice(1)}${clockSeq}${nodeHex}`;
        details.randomPart = hashBits;
        details.notes.push('Name-based hash; no embedded timestamp.');
        break;
      }
      case 4: {
        const randomHex = `${timeLow}${timeMid}${timeHiVer.slice(1)}${((clockSeqHi & 0x3f) << 8 | clockSeqLow).toString(16).padStart(4, '0')}${nodeHex}`;
        details.randomPart = randomHex;
        details.notes.push('Fully random UUID; no embedded timestamp.');
        break;
      }
      case 6: {
        try {
          const ts100ns = (BigInt(`0x${timeLow}`) << 28n)
            | (BigInt(`0x${timeMid}`) << 12n)
            | (BigInt(`0x${timeHiVer}`) & 0x0fffn);
          details.timestamp = buildTimestampFrom100ns(ts100ns);
        } catch {
          details.notes.push('Unable to interpret timestamp for v6 UUID');
        }
        details.clockSequence = clockSeqValue;
        details.macAddress = macAddr;
        break;
      }
      case 7: {
        try {
          const tsMs = (BigInt(`0x${timeLow}`) << 16n) | BigInt(`0x${timeMid}`);
          const msNumber = Number(tsMs);
          if (Number.isFinite(msNumber)) {
            details.timestamp = { iso: new Date(msNumber).toISOString(), unixMillis: msNumber };
          }
          const randPart = `${timeHiVer.slice(1)}${((clockSeqHi & 0x3f) << 8 | clockSeqLow).toString(16).padStart(4, '0')}${nodeHex}`;
          details.randomPart = randPart;
        } catch {
          details.notes.push('Unable to interpret timestamp for v7 UUID');
        }
        break;
      }
      default: {
        details.timestamp = null;
        details.clockSequence = null;
        details.macAddress = null;
        details.randomPart = null;
        details.notes.push('Unrecognized or missing version nibble; fields not interpreted.');
      }
    }

    return details;
  }

  function findUuidMatches(text) {
    if (typeof text !== 'string' || !text) return [];
    const re = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g;
    const matches = [];
    let m;

    while ((m = re.exec(text)) !== null) {
      const uuid = m[0];
      const parsed = parseUuidDetails(uuid);
      matches.push(parsed);
    }
    return matches;
  }

  function updateNgUuidList(ng, decodedBase64Entries = [], decodedBase64UrlEntries = []) {
    if (!ngUuidListEl) return;
    try {
      ngUuidListEl.innerHTML = '';
      if (!ng || typeof ng.data !== 'string') {
        ngUuidListEl.hidden = true;
        return;
      }

      const collected = [];
      findUuidMatches(ng.data).forEach(match => collected.push({ ...match, source: 'Original data text' }));

      decodedBase64Entries.forEach((entry, idx) => {
        const source = (entry && entry.source) || `Decoded base64 #${idx + 1}`;
        findUuidMatches(entry && entry.decoded).forEach(match => collected.push({ ...match, source }));
      });

      decodedBase64UrlEntries.forEach((entry, idx) => {
        const source = (entry && entry.source) || `Decoded base64url #${idx + 1}`;
        findUuidMatches(entry && entry.decoded).forEach(match => collected.push({ ...match, source }));
      });

      const seen = new Set();
      const unique = [];
      collected.forEach((entry) => {
        const { uuid, source } = entry;
        const key = `${uuid}__${source}`;
        if (seen.has(key)) return;
        seen.add(key);
        unique.push(entry);
      });

      if (!unique.length) {
        ngUuidListEl.hidden = true;
        return;
      }

      const header = document.createElement('div');
      header.textContent = `UUIDs found: ${unique.length}`;
      ngUuidListEl.appendChild(header);

      const list = document.createElement('ul');
      unique.forEach(({ uuid, source, version, variant, timestamp, macAddress, clockSequence, randomPart, notes }) => {
        const li = document.createElement('li');
        const versionLabel = Number.isInteger(version) ? `Version ${version}` : 'Version unknown';
        const variantLabel = variant || 'Variant unknown';

        const detailList = document.createElement('ul');
        const addDetail = (label, value) => {
          const row = document.createElement('li');
          row.textContent = `${label}: ${value}`;
          detailList.appendChild(row);
        };

        const summary = document.createElement('div');
        summary.textContent = `${uuid}`;
        li.appendChild(summary);

        addDetail('Version', versionLabel);
        addDetail('Variant', variantLabel);
        addDetail('Source', source);

        const addIfExpected = (shouldShow, label, value) => {
          if (!shouldShow) return;
          addDetail(label, value);
        };

        switch (version) {
          case 1:
            addIfExpected(true, 'Timestamp', timestamp?.iso || 'Unavailable');
            addIfExpected(true, 'Clock/sequence', Number.isInteger(clockSequence) ? clockSequence : 'Unavailable');
            addIfExpected(true, 'MAC/Node', macAddress || 'Unavailable');
            break;
          case 2:
            addIfExpected(true, 'Clock/sequence', Number.isInteger(clockSequence) ? clockSequence : 'Unavailable');
            addIfExpected(true, 'MAC/Node', macAddress || 'Unavailable');
            break;
          case 3:
          case 5:
            addIfExpected(true, 'Hash bits', randomPart || 'Unavailable');
            break;
          case 4:
            addIfExpected(true, 'Random bits', randomPart || 'Unavailable');
            break;
          case 6:
            addIfExpected(true, 'Timestamp', timestamp?.iso || 'Unavailable');
            addIfExpected(true, 'Clock/sequence', Number.isInteger(clockSequence) ? clockSequence : 'Unavailable');
            addIfExpected(true, 'MAC/Node', macAddress || 'Unavailable');
            break;
          case 7:
            addIfExpected(true, 'Timestamp', timestamp?.iso || 'Unavailable');
            addIfExpected(true, 'Random bits', randomPart || 'Unavailable');
            break;
          default:
            addIfExpected(Boolean(timestamp), 'Timestamp', timestamp?.iso || 'Unavailable');
            addIfExpected(Number.isInteger(clockSequence), 'Clock/sequence', clockSequence);
            addIfExpected(Boolean(macAddress), 'MAC/Node', macAddress);
            addIfExpected(Boolean(randomPart), 'Random/Hash bits', randomPart);
        }

        if (Array.isArray(notes) && notes.length) {
          const notesRow = document.createElement('li');
          notesRow.textContent = `Notes: ${notes.join(' ')}`;
          detailList.appendChild(notesRow);
        }

        li.appendChild(detailList);
        list.appendChild(li);
      });

      ngUuidListEl.appendChild(list);
      ngUuidListEl.hidden = false;
    } catch {
      ngUuidListEl.hidden = true;
      ngUuidListEl.textContent = '';
    }
  }

  function updateToggleLabel(button, isVisible, label) {
    if (!button) { return; }
    button.textContent = `${isVisible ? 'Hide' : 'Show'} ${label}`;
  }

  function setupToggle(button, targets, label) {
    if (!button || !targets) { return; }
    const list = Array.isArray(targets) ? targets.filter(Boolean) : [targets];
    if (!list.length) return;
    const anyVisible = () => list.some(el => !el.hidden);
    const setVisibility = (visible) => {
      list.forEach(el => { el.hidden = !visible; });
      updateToggleLabel(button, visible, label);
    };
    setVisibility(anyVisible());
    button.addEventListener('click', () => {
      setVisibility(!anyVisible());
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

  function waitForCameraLayout() {
    // Allow the camera elements to enter the layout before scrolling
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
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
    startCameraButton.addEventListener('click', async () => {
      await startCamera();
      await waitForCameraLayout();
      scrollCameraControlsIntoView();
    });
    capturePhotoButton.addEventListener('click', capturePhoto);
    stopCameraButton.addEventListener('click', stopCamera);
    if (startCameraScanButton) {
      startCameraScanButton.addEventListener('click', async () => {
        await startCameraScan();
        await waitForCameraLayout();
        scrollCameraControlsIntoView();
      });
    }
    if (listCamerasButton) {
      listCamerasButton.addEventListener('click', handleListCamerasButtonClick);
    }
  }

  function setupResultToggles() {
    setupToggle(toggleNgButton, [qrOutputNG, ngLinksEl, ngBase64ListEl], 'Nitty Gritty');
    setupToggle(toggleOriginalButton, [qrOutputOriginal, originalLinksEl], 'Original');
    setupToggle(toggleZXingButton, [qrOutputZXing, zxingLinksEl], 'ZXing');
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
