(function(){
  const fileInput = document.getElementById('fileInput');
  const pasteButton = document.getElementById('pasteButton');
  const cameraToggle = document.getElementById('cameraToggle');
  const captureFrameButton = document.getElementById('captureFrame');
  const cameraPreview = document.getElementById('cameraPreview');
  const statusEl = document.getElementById('status');
  const detailsEl = document.getElementById('details');
  const pasteStatusEl = document.getElementById('pasteStatus');
  const workCanvas = document.getElementById('workCanvas');
  const ctx = workCanvas.getContext('2d');

  let awaitingManualPaste = false;
  let manualPasteTimer = null;
  let mediaStream = null;

  const maskDescriptions = [
    '(x + y) mod 2 == 0',
    'y mod 2 == 0',
    'x mod 3 == 0',
    '(x + y) mod 3 == 0',
    '(⌊y / 2⌋ + ⌊x / 3⌋) mod 2 == 0',
    '((x·y mod 2) + (x·y mod 3)) mod 2 == 0',
    '(((x·y mod 2) + (x·y mod 3)) mod 2) == 0 (diagonal)',
    '(((x + y) mod 2) + (x·y mod 3)) mod 2 == 0'
  ];

  const ERROR_CORRECTION_MAP = ['M', 'L', 'H', 'Q'];
  const ERROR_CORRECTION_INFO = {
    'L': 'Low (≈7% restoration)',
    'M': 'Medium (≈15% restoration)',
    'Q': 'Quartile (≈25% restoration)',
    'H': 'High (≈30% restoration)'
  };
  class BitMatrix {
    static createEmpty(width, height) {
      return new BitMatrix(new Uint8ClampedArray(width * height), width);
    }
    constructor(data, width) {
      this.width = width;
      this.height = data.length / width;
      this.data = data;
    }
    get(x, y) {
      if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
        return false;
      }
      return !!this.data[y * this.width + x];
    }
    set(x, y, value) {
      this.data[y * this.width + x] = value ? 1 : 0;
    }
    setRegion(left, top, width, height, value) {
      for (let yy = top; yy < top + height; yy++) {
        for (let xx = left; xx < left + width; xx++) {
          this.set(xx, yy, value);
        }
      }
    }
  }

  function binarize(data, width, height) {
    const REGION_SIZE = 8;
    const MIN_DYNAMIC_RANGE = 24;

    if (data.length !== width * height * 4) {
      throw new Error('Malformed image data');
    }

    class GreyMatrix {
      constructor(w, h) {
        this.width = w;
        this.height = h;
        this.data = new Uint8ClampedArray(w * h);
      }
      get(x, y) {
        if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
          return 0;
        }
        return this.data[y * this.width + x];
      }
      set(x, y, value) {
        if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
          return;
        }
        this.data[y * this.width + x] = value;
      }
    }

    const greyscale = new GreyMatrix(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        const r = data[offset];
        const g = data[offset + 1];
        const b = data[offset + 2];
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        greyscale.set(x, y, lum);
      }
    }

    const horizontalRegions = Math.ceil(width / REGION_SIZE);
    const verticalRegions = Math.ceil(height / REGION_SIZE);

    const blackPoints = new GreyMatrix(horizontalRegions, verticalRegions);
    for (let v = 0; v < verticalRegions; v++) {
      for (let h = 0; h < horizontalRegions; h++) {
        let sum = 0;
        let min = Infinity;
        let max = 0;
        for (let y = 0; y < REGION_SIZE; y++) {
          for (let x = 0; x < REGION_SIZE; x++) {
            const pixel = greyscale.get(h * REGION_SIZE + x, v * REGION_SIZE + y);
            sum += pixel;
            min = Math.min(min, pixel);
            max = Math.max(max, pixel);
          }
        }
        let average = sum / (REGION_SIZE * REGION_SIZE);
        if (max - min <= MIN_DYNAMIC_RANGE) {
          average = min / 2;
          if (v > 0 && h > 0) {
            const neighborAverage = (
              blackPoints.get(h, v - 1) +
              (2 * blackPoints.get(h - 1, v)) +
              blackPoints.get(h - 1, v - 1)
            ) / 4;
            if (min < neighborAverage) {
              average = neighborAverage;
            }
          }
        }
        blackPoints.set(h, v, average);
      }
    }

    const binarized = BitMatrix.createEmpty(width, height);

    function clamp(value, min, max) {
      return value < min ? min : value > max ? max : value;
    }

    for (let v = 0; v < verticalRegions; v++) {
      for (let h = 0; h < horizontalRegions; h++) {
        const left = clamp(h, 2, horizontalRegions - 3);
        const top = clamp(v, 2, verticalRegions - 3);
        let sum = 0;
        for (let dx = -2; dx <= 2; dx++) {
          for (let dy = -2; dy <= 2; dy++) {
            sum += blackPoints.get(left + dx, top + dy);
          }
        }
        const threshold = sum / 25;
        for (let xRegion = 0; xRegion < REGION_SIZE; xRegion++) {
          for (let yRegion = 0; yRegion < REGION_SIZE; yRegion++) {
            const x = h * REGION_SIZE + xRegion;
            const y = v * REGION_SIZE + yRegion;
            if (x < width && y < height) {
              const lum = greyscale.get(x, y);
              binarized.set(x, y, lum <= threshold);
            }
          }
        }
      }
    }

    return binarized;
  }
  function squareToQuadrilateral(p1, p2, p3, p4) {
    const dx3 = p1.x - p2.x + p3.x - p4.x;
    const dy3 = p1.y - p2.y + p3.y - p4.y;
    if (dx3 === 0 && dy3 === 0) {
      return {
        a11: p2.x - p1.x,
        a12: p2.y - p1.y,
        a13: 0,
        a21: p3.x - p2.x,
        a22: p3.y - p2.y,
        a23: 0,
        a31: p1.x,
        a32: p1.y,
        a33: 1
      };
    }
    const dx1 = p2.x - p3.x;
    const dx2 = p4.x - p3.x;
    const dy1 = p2.y - p3.y;
    const dy2 = p4.y - p3.y;
    const denominator = dx1 * dy2 - dx2 * dy1;
    const a13 = (dx3 * dy2 - dx2 * dy3) / denominator;
    const a23 = (dx1 * dy3 - dx3 * dy1) / denominator;
    return {
      a11: p2.x - p1.x + a13 * p2.x,
      a12: p2.y - p1.y + a13 * p2.y,
      a13,
      a21: p4.x - p1.x + a23 * p4.x,
      a22: p4.y - p1.y + a23 * p4.y,
      a23,
      a31: p1.x,
      a32: p1.y,
      a33: 1
    };
  }

  function quadrilateralToSquare(p1, p2, p3, p4) {
    const sToQ = squareToQuadrilateral(p1, p2, p3, p4);
    return {
      a11: sToQ.a22 * sToQ.a33 - sToQ.a23 * sToQ.a32,
      a12: sToQ.a13 * sToQ.a32 - sToQ.a12 * sToQ.a33,
      a13: sToQ.a12 * sToQ.a23 - sToQ.a13 * sToQ.a22,
      a21: sToQ.a23 * sToQ.a31 - sToQ.a21 * sToQ.a33,
      a22: sToQ.a11 * sToQ.a33 - sToQ.a13 * sToQ.a31,
      a23: sToQ.a13 * sToQ.a21 - sToQ.a11 * sToQ.a23,
      a31: sToQ.a21 * sToQ.a32 - sToQ.a22 * sToQ.a31,
      a32: sToQ.a12 * sToQ.a31 - sToQ.a11 * sToQ.a32,
      a33: sToQ.a11 * sToQ.a22 - sToQ.a12 * sToQ.a21
    };
  }

  function multiplyTransform(a, b) {
    return {
      a11: a.a11 * b.a11 + a.a21 * b.a12 + a.a31 * b.a13,
      a12: a.a12 * b.a11 + a.a22 * b.a12 + a.a32 * b.a13,
      a13: a.a13 * b.a11 + a.a23 * b.a12 + a.a33 * b.a13,
      a21: a.a11 * b.a21 + a.a21 * b.a22 + a.a31 * b.a23,
      a22: a.a12 * b.a21 + a.a22 * b.a22 + a.a32 * b.a23,
      a23: a.a13 * b.a21 + a.a23 * b.a22 + a.a33 * b.a23,
      a31: a.a11 * b.a31 + a.a21 * b.a32 + a.a31 * b.a33,
      a32: a.a12 * b.a31 + a.a22 * b.a32 + a.a32 * b.a33,
      a33: a.a13 * b.a31 + a.a23 * b.a32 + a.a33 * b.a33
    };
  }

  function extractMatrix(imageMatrix, location) {
    const qToS = quadrilateralToSquare(
      { x: 3.5, y: 3.5 },
      { x: location.dimension - 3.5, y: 3.5 },
      { x: location.dimension - 6.5, y: location.dimension - 6.5 },
      { x: 3.5, y: location.dimension - 3.5 }
    );
    const sToQ = squareToQuadrilateral(location.topLeft, location.topRight, location.alignmentPattern, location.bottomLeft);
    const transform = multiplyTransform(sToQ, qToS);
    const matrix = BitMatrix.createEmpty(location.dimension, location.dimension);
    for (let y = 0; y < location.dimension; y++) {
      for (let x = 0; x < location.dimension; x++) {
        const mappedXNumerator = transform.a11 * (x + 0.5) + transform.a21 * (y + 0.5) + transform.a31;
        const mappedYNumerator = transform.a12 * (x + 0.5) + transform.a22 * (y + 0.5) + transform.a32;
        const denominator = transform.a13 * (x + 0.5) + transform.a23 * (y + 0.5) + transform.a33;
        const mappedX = mappedXNumerator / denominator;
        const mappedY = mappedYNumerator / denominator;
        matrix.set(x, y, imageMatrix.get(Math.floor(mappedX), Math.floor(mappedY)));
      }
    }
    return matrix;
  }
  const FORMAT_INFO_TABLE = [
    { bits: 0x5412, errorCorrectionLevel: 1, dataMask: 0 },
    { bits: 0x5125, errorCorrectionLevel: 1, dataMask: 1 },
    { bits: 0x5E7C, errorCorrectionLevel: 1, dataMask: 2 },
    { bits: 0x5B4B, errorCorrectionLevel: 1, dataMask: 3 },
    { bits: 0x45F9, errorCorrectionLevel: 1, dataMask: 4 },
    { bits: 0x40CE, errorCorrectionLevel: 1, dataMask: 5 },
    { bits: 0x4F97, errorCorrectionLevel: 1, dataMask: 6 },
    { bits: 0x4AA0, errorCorrectionLevel: 1, dataMask: 7 },
    { bits: 0x77C4, errorCorrectionLevel: 0, dataMask: 0 },
    { bits: 0x72F3, errorCorrectionLevel: 0, dataMask: 1 },
    { bits: 0x7DAA, errorCorrectionLevel: 0, dataMask: 2 },
    { bits: 0x789D, errorCorrectionLevel: 0, dataMask: 3 },
    { bits: 0x662F, errorCorrectionLevel: 0, dataMask: 4 },
    { bits: 0x6318, errorCorrectionLevel: 0, dataMask: 5 },
    { bits: 0x6C41, errorCorrectionLevel: 0, dataMask: 6 },
    { bits: 0x6976, errorCorrectionLevel: 0, dataMask: 7 },
    { bits: 0x1689, errorCorrectionLevel: 3, dataMask: 0 },
    { bits: 0x13BE, errorCorrectionLevel: 3, dataMask: 1 },
    { bits: 0x1CE7, errorCorrectionLevel: 3, dataMask: 2 },
    { bits: 0x19D0, errorCorrectionLevel: 3, dataMask: 3 },
    { bits: 0x0762, errorCorrectionLevel: 3, dataMask: 4 },
    { bits: 0x0255, errorCorrectionLevel: 3, dataMask: 5 },
    { bits: 0x0D0C, errorCorrectionLevel: 3, dataMask: 6 },
    { bits: 0x083B, errorCorrectionLevel: 3, dataMask: 7 },
    { bits: 0x355F, errorCorrectionLevel: 2, dataMask: 0 },
    { bits: 0x3068, errorCorrectionLevel: 2, dataMask: 1 },
    { bits: 0x3F31, errorCorrectionLevel: 2, dataMask: 2 },
    { bits: 0x3A06, errorCorrectionLevel: 2, dataMask: 3 },
    { bits: 0x24B4, errorCorrectionLevel: 2, dataMask: 4 },
    { bits: 0x2183, errorCorrectionLevel: 2, dataMask: 5 },
    { bits: 0x2EDA, errorCorrectionLevel: 2, dataMask: 6 },
    { bits: 0x2BED, errorCorrectionLevel: 2, dataMask: 7 }
  ];

  function numBitsDiffering(x, y) {
    let z = x ^ y;
    let count = 0;
    while (z) {
      count++;
      z &= z - 1;
    }
    return count;
  }

  function readFormatInformation(matrix) {
    const dimension = matrix.height;
    const pushBit = (bit, byte) => (byte << 1) | (bit ? 1 : 0);

    let topLeftFormat = 0;
    for (let x = 0; x <= 8; x++) {
      if (x !== 6) {
        topLeftFormat = pushBit(matrix.get(x, 8), topLeftFormat);
      }
    }
    for (let y = 7; y >= 0; y--) {
      if (y !== 6) {
        topLeftFormat = pushBit(matrix.get(8, y), topLeftFormat);
      }
    }

    let otherFormat = 0;
    for (let y = dimension - 1; y >= dimension - 7; y--) {
      otherFormat = pushBit(matrix.get(8, y), otherFormat);
    }
    for (let x = dimension - 8; x < dimension; x++) {
      otherFormat = pushBit(matrix.get(x, 8), otherFormat);
    }

    let bestMatch = null;
    let bestDifference = Infinity;
    for (const entry of FORMAT_INFO_TABLE) {
      if (entry.bits === topLeftFormat || entry.bits === otherFormat) {
        return { errorCorrectionLevel: entry.errorCorrectionLevel, dataMask: entry.dataMask };
      }
      const diff1 = numBitsDiffering(entry.bits, topLeftFormat);
      if (diff1 < bestDifference) {
        bestDifference = diff1;
        bestMatch = entry;
      }
      if (topLeftFormat !== otherFormat) {
        const diff2 = numBitsDiffering(entry.bits, otherFormat);
        if (diff2 < bestDifference) {
          bestDifference = diff2;
          bestMatch = entry;
        }
      }
    }
    if (bestDifference <= 3 && bestMatch) {
      return { errorCorrectionLevel: bestMatch.errorCorrectionLevel, dataMask: bestMatch.dataMask };
    }
    return null;
  }
  const VERSIONS = [
    { number: 1, errorCorrectionLevels: [
      { ecCodewordsPerBlock: 7, ecBlocks: [{ numBlocks: 1, dataCodewordsPerBlock: 19 }] },
      { ecCodewordsPerBlock: 10, ecBlocks: [{ numBlocks: 1, dataCodewordsPerBlock: 16 }] },
      { ecCodewordsPerBlock: 13, ecBlocks: [{ numBlocks: 1, dataCodewordsPerBlock: 13 }] },
      { ecCodewordsPerBlock: 17, ecBlocks: [{ numBlocks: 1, dataCodewordsPerBlock: 9 }] }
    ]},
    { number: 2, errorCorrectionLevels: [
      { ecCodewordsPerBlock: 10, ecBlocks: [{ numBlocks: 1, dataCodewordsPerBlock: 34 }] },
      { ecCodewordsPerBlock: 16, ecBlocks: [{ numBlocks: 1, dataCodewordsPerBlock: 28 }] },
      { ecCodewordsPerBlock: 22, ecBlocks: [{ numBlocks: 1, dataCodewordsPerBlock: 22 }] },
      { ecCodewordsPerBlock: 28, ecBlocks: [{ numBlocks: 1, dataCodewordsPerBlock: 16 }] }
    ]},
    { number: 3, errorCorrectionLevels: [
      { ecCodewordsPerBlock: 15, ecBlocks: [{ numBlocks: 1, dataCodewordsPerBlock: 55 }] },
      { ecCodewordsPerBlock: 26, ecBlocks: [{ numBlocks: 1, dataCodewordsPerBlock: 44 }] },
      { ecCodewordsPerBlock: 18, ecBlocks: [{ numBlocks: 2, dataCodewordsPerBlock: 17 }] },
      { ecCodewordsPerBlock: 22, ecBlocks: [{ numBlocks: 2, dataCodewordsPerBlock: 13 }] }
    ]},
    { number: 4, errorCorrectionLevels: [
      { ecCodewordsPerBlock: 20, ecBlocks: [{ numBlocks: 1, dataCodewordsPerBlock: 80 }] },
      { ecCodewordsPerBlock: 18, ecBlocks: [{ numBlocks: 2, dataCodewordsPerBlock: 32 }] },
      { ecCodewordsPerBlock: 26, ecBlocks: [{ numBlocks: 2, dataCodewordsPerBlock: 24 }] },
      { ecCodewordsPerBlock: 16, ecBlocks: [{ numBlocks: 4, dataCodewordsPerBlock: 9 }] }
    ]},
    { number: 5, errorCorrectionLevels: [
      { ecCodewordsPerBlock: 26, ecBlocks: [{ numBlocks: 1, dataCodewordsPerBlock: 108 }] },
      { ecCodewordsPerBlock: 24, ecBlocks: [{ numBlocks: 2, dataCodewordsPerBlock: 43 }] },
      { ecCodewordsPerBlock: 18, ecBlocks: [{ numBlocks: 2, dataCodewordsPerBlock: 15 }, { numBlocks: 2, dataCodewordsPerBlock: 16 }] },
      { ecCodewordsPerBlock: 22, ecBlocks: [{ numBlocks: 2, dataCodewordsPerBlock: 11 }, { numBlocks: 2, dataCodewordsPerBlock: 12 }] }
    ]},
    { number: 6, errorCorrectionLevels: [
      { ecCodewordsPerBlock: 18, ecBlocks: [{ numBlocks: 2, dataCodewordsPerBlock: 68 }] },
      { ecCodewordsPerBlock: 16, ecBlocks: [{ numBlocks: 4, dataCodewordsPerBlock: 27 }] },
      { ecCodewordsPerBlock: 24, ecBlocks: [{ numBlocks: 4, dataCodewordsPerBlock: 19 }] },
      { ecCodewordsPerBlock: 28, ecBlocks: [{ numBlocks: 4, dataCodewordsPerBlock: 15 }] }
    ]},
    { number: 7, errorCorrectionLevels: [
      { ecCodewordsPerBlock: 20, ecBlocks: [{ numBlocks: 2, dataCodewordsPerBlock: 78 }] },
      { ecCodewordsPerBlock: 18, ecBlocks: [{ numBlocks: 4, dataCodewordsPerBlock: 31 }] },
      { ecCodewordsPerBlock: 18, ecBlocks: [{ numBlocks: 2, dataCodewordsPerBlock: 14 }, { numBlocks: 4, dataCodewordsPerBlock: 15 }] },
      { ecCodewordsPerBlock: 26, ecBlocks: [{ numBlocks: 4, dataCodewordsPerBlock: 13 }, { numBlocks: 1, dataCodewordsPerBlock: 14 }] }
    ]},
    { number: 8, errorCorrectionLevels: [
      { ecCodewordsPerBlock: 24, ecBlocks: [{ numBlocks: 2, dataCodewordsPerBlock: 97 }] },
      { ecCodewordsPerBlock: 22, ecBlocks: [{ numBlocks: 2, dataCodewordsPerBlock: 38 }, { numBlocks: 2, dataCodewordsPerBlock: 39 }] },
      { ecCodewordsPerBlock: 22, ecBlocks: [{ numBlocks: 4, dataCodewordsPerBlock: 18 }, { numBlocks: 2, dataCodewordsPerBlock: 19 }] },
      { ecCodewordsPerBlock: 26, ecBlocks: [{ numBlocks: 4, dataCodewordsPerBlock: 14 }, { numBlocks: 2, dataCodewordsPerBlock: 15 }] }
    ]},
    { number: 9, errorCorrectionLevels: [
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 2, dataCodewordsPerBlock: 116 }] },
      { ecCodewordsPerBlock: 22, ecBlocks: [{ numBlocks: 3, dataCodewordsPerBlock: 36 }, { numBlocks: 2, dataCodewordsPerBlock: 37 }] },
      { ecCodewordsPerBlock: 20, ecBlocks: [{ numBlocks: 4, dataCodewordsPerBlock: 16 }, { numBlocks: 4, dataCodewordsPerBlock: 17 }] },
      { ecCodewordsPerBlock: 24, ecBlocks: [{ numBlocks: 4, dataCodewordsPerBlock: 12 }, { numBlocks: 4, dataCodewordsPerBlock: 13 }] }
    ]},
    { number: 10, errorCorrectionLevels: [
      { ecCodewordsPerBlock: 18, ecBlocks: [{ numBlocks: 2, dataCodewordsPerBlock: 68 }, { numBlocks: 2, dataCodewordsPerBlock: 69 }] },
      { ecCodewordsPerBlock: 26, ecBlocks: [{ numBlocks: 4, dataCodewordsPerBlock: 43 }, { numBlocks: 1, dataCodewordsPerBlock: 44 }] },
      { ecCodewordsPerBlock: 24, ecBlocks: [{ numBlocks: 6, dataCodewordsPerBlock: 19 }, { numBlocks: 2, dataCodewordsPerBlock: 20 }] },
      { ecCodewordsPerBlock: 28, ecBlocks: [{ numBlocks: 6, dataCodewordsPerBlock: 15 }, { numBlocks: 2, dataCodewordsPerBlock: 16 }] }
    ]},
    { number: 11, errorCorrectionLevels: [
      { ecCodewordsPerBlock: 20, ecBlocks: [{ numBlocks: 4, dataCodewordsPerBlock: 81 }] },
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 1, dataCodewordsPerBlock: 50 }, { numBlocks: 4, dataCodewordsPerBlock: 51 }] },
      { ecCodewordsPerBlock: 28, ecBlocks: [{ numBlocks: 4, dataCodewordsPerBlock: 22 }, { numBlocks: 4, dataCodewordsPerBlock: 23 }] },
      { ecCodewordsPerBlock: 24, ecBlocks: [{ numBlocks: 3, dataCodewordsPerBlock: 12 }, { numBlocks: 8, dataCodewordsPerBlock: 13 }] }
    ]},
    { number: 12, errorCorrectionLevels: [
      { ecCodewordsPerBlock: 24, ecBlocks: [{ numBlocks: 2, dataCodewordsPerBlock: 92 }, { numBlocks: 2, dataCodewordsPerBlock: 93 }] },
      { ecCodewordsPerBlock: 22, ecBlocks: [{ numBlocks: 6, dataCodewordsPerBlock: 36 }, { numBlocks: 2, dataCodewordsPerBlock: 37 }] },
      { ecCodewordsPerBlock: 26, ecBlocks: [{ numBlocks: 4, dataCodewordsPerBlock: 20 }, { numBlocks: 6, dataCodewordsPerBlock: 21 }] },
      { ecCodewordsPerBlock: 28, ecBlocks: [{ numBlocks: 7, dataCodewordsPerBlock: 14 }, { numBlocks: 4, dataCodewordsPerBlock: 15 }] }
    ]},
    { number: 13, errorCorrectionLevels: [
      { ecCodewordsPerBlock: 26, ecBlocks: [{ numBlocks: 4, dataCodewordsPerBlock: 107 }] },
      { ecCodewordsPerBlock: 22, ecBlocks: [{ numBlocks: 8, dataCodewordsPerBlock: 37 }, { numBlocks: 1, dataCodewordsPerBlock: 38 }] },
      { ecCodewordsPerBlock: 24, ecBlocks: [{ numBlocks: 8, dataCodewordsPerBlock: 20 }, { numBlocks: 4, dataCodewordsPerBlock: 21 }] },
      { ecCodewordsPerBlock: 22, ecBlocks: [{ numBlocks: 12, dataCodewordsPerBlock: 11 }, { numBlocks: 4, dataCodewordsPerBlock: 12 }] }
    ]},
    { number: 14, errorCorrectionLevels: [
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 3, dataCodewordsPerBlock: 115 }, { numBlocks: 1, dataCodewordsPerBlock: 116 }] },
      { ecCodewordsPerBlock: 24, ecBlocks: [{ numBlocks: 4, dataCodewordsPerBlock: 40 }, { numBlocks: 5, dataCodewordsPerBlock: 41 }] },
      { ecCodewordsPerBlock: 20, ecBlocks: [{ numBlocks: 11, dataCodewordsPerBlock: 16 }, { numBlocks: 5, dataCodewordsPerBlock: 17 }] },
      { ecCodewordsPerBlock: 24, ecBlocks: [{ numBlocks: 11, dataCodewordsPerBlock: 12 }, { numBlocks: 5, dataCodewordsPerBlock: 13 }] }
    ]},
    { number: 15, errorCorrectionLevels: [
      { ecCodewordsPerBlock: 22, ecBlocks: [{ numBlocks: 5, dataCodewordsPerBlock: 87 }, { numBlocks: 1, dataCodewordsPerBlock: 88 }] },
      { ecCodewordsPerBlock: 24, ecBlocks: [{ numBlocks: 5, dataCodewordsPerBlock: 41 }, { numBlocks: 5, dataCodewordsPerBlock: 42 }] },
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 5, dataCodewordsPerBlock: 24 }, { numBlocks: 7, dataCodewordsPerBlock: 25 }] },
      { ecCodewordsPerBlock: 24, ecBlocks: [{ numBlocks: 11, dataCodewordsPerBlock: 12 }, { numBlocks: 7, dataCodewordsPerBlock: 13 }] }
    ]},
    { number: 16, errorCorrectionLevels: [
      { ecCodewordsPerBlock: 24, ecBlocks: [{ numBlocks: 5, dataCodewordsPerBlock: 98 }, { numBlocks: 1, dataCodewordsPerBlock: 99 }] },
      { ecCodewordsPerBlock: 28, ecBlocks: [{ numBlocks: 7, dataCodewordsPerBlock: 45 }, { numBlocks: 3, dataCodewordsPerBlock: 46 }] },
      { ecCodewordsPerBlock: 24, ecBlocks: [{ numBlocks: 15, dataCodewordsPerBlock: 19 }, { numBlocks: 2, dataCodewordsPerBlock: 20 }] },
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 3, dataCodewordsPerBlock: 15 }, { numBlocks: 13, dataCodewordsPerBlock: 16 }] }
    ]},
    { number: 17, errorCorrectionLevels: [
      { ecCodewordsPerBlock: 28, ecBlocks: [{ numBlocks: 1, dataCodewordsPerBlock: 107 }, { numBlocks: 5, dataCodewordsPerBlock: 108 }] },
      { ecCodewordsPerBlock: 28, ecBlocks: [{ numBlocks: 10, dataCodewordsPerBlock: 46 }, { numBlocks: 1, dataCodewordsPerBlock: 47 }] },
      { ecCodewordsPerBlock: 28, ecBlocks: [{ numBlocks: 1, dataCodewordsPerBlock: 22 }, { numBlocks: 15, dataCodewordsPerBlock: 23 }] },
      { ecCodewordsPerBlock: 28, ecBlocks: [{ numBlocks: 2, dataCodewordsPerBlock: 14 }, { numBlocks: 17, dataCodewordsPerBlock: 15 }] }
    ]},
    { number: 18, errorCorrectionLevels: [
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 5, dataCodewordsPerBlock: 120 }, { numBlocks: 1, dataCodewordsPerBlock: 121 }] },
      { ecCodewordsPerBlock: 26, ecBlocks: [{ numBlocks: 9, dataCodewordsPerBlock: 43 }, { numBlocks: 4, dataCodewordsPerBlock: 44 }] },
      { ecCodewordsPerBlock: 28, ecBlocks: [{ numBlocks: 17, dataCodewordsPerBlock: 22 }, { numBlocks: 1, dataCodewordsPerBlock: 23 }] },
      { ecCodewordsPerBlock: 28, ecBlocks: [{ numBlocks: 2, dataCodewordsPerBlock: 14 }, { numBlocks: 19, dataCodewordsPerBlock: 15 }] }
    ]}
    ,{ number: 19, errorCorrectionLevels: [
      { ecCodewordsPerBlock: 28, ecBlocks: [{ numBlocks: 3, dataCodewordsPerBlock: 113 }, { numBlocks: 4, dataCodewordsPerBlock: 114 }] },
      { ecCodewordsPerBlock: 26, ecBlocks: [{ numBlocks: 3, dataCodewordsPerBlock: 44 }, { numBlocks: 11, dataCodewordsPerBlock: 45 }] },
      { ecCodewordsPerBlock: 26, ecBlocks: [{ numBlocks: 17, dataCodewordsPerBlock: 21 }, { numBlocks: 4, dataCodewordsPerBlock: 22 }] },
      { ecCodewordsPerBlock: 26, ecBlocks: [{ numBlocks: 9, dataCodewordsPerBlock: 13 }, { numBlocks: 16, dataCodewordsPerBlock: 14 }] }
    ]},
    { number: 20, errorCorrectionLevels: [
      { ecCodewordsPerBlock: 28, ecBlocks: [{ numBlocks: 3, dataCodewordsPerBlock: 107 }, { numBlocks: 5, dataCodewordsPerBlock: 108 }] },
      { ecCodewordsPerBlock: 26, ecBlocks: [{ numBlocks: 3, dataCodewordsPerBlock: 41 }, { numBlocks: 13, dataCodewordsPerBlock: 42 }] },
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 15, dataCodewordsPerBlock: 24 }, { numBlocks: 5, dataCodewordsPerBlock: 25 }] },
      { ecCodewordsPerBlock: 28, ecBlocks: [{ numBlocks: 15, dataCodewordsPerBlock: 15 }, { numBlocks: 10, dataCodewordsPerBlock: 16 }] }
    ]},
    { number: 21, errorCorrectionLevels: [
      { ecCodewordsPerBlock: 28, ecBlocks: [{ numBlocks: 4, dataCodewordsPerBlock: 116 }, { numBlocks: 4, dataCodewordsPerBlock: 117 }] },
      { ecCodewordsPerBlock: 26, ecBlocks: [{ numBlocks: 17, dataCodewordsPerBlock: 42 }] },
      { ecCodewordsPerBlock: 28, ecBlocks: [{ numBlocks: 17, dataCodewordsPerBlock: 22 }, { numBlocks: 6, dataCodewordsPerBlock: 23 }] },
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 19, dataCodewordsPerBlock: 16 }, { numBlocks: 6, dataCodewordsPerBlock: 17 }] }
    ]},
    { number: 22, errorCorrectionLevels: [
      { ecCodewordsPerBlock: 28, ecBlocks: [{ numBlocks: 2, dataCodewordsPerBlock: 111 }, { numBlocks: 7, dataCodewordsPerBlock: 112 }] },
      { ecCodewordsPerBlock: 28, ecBlocks: [{ numBlocks: 17, dataCodewordsPerBlock: 46 }] },
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 7, dataCodewordsPerBlock: 24 }, { numBlocks: 16, dataCodewordsPerBlock: 25 }] },
      { ecCodewordsPerBlock: 24, ecBlocks: [{ numBlocks: 34, dataCodewordsPerBlock: 13 }] }
    ]},
    { number: 23, errorCorrectionLevels: [
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 4, dataCodewordsPerBlock: 121 }, { numBlocks: 5, dataCodewordsPerBlock: 122 }] },
      { ecCodewordsPerBlock: 28, ecBlocks: [{ numBlocks: 4, dataCodewordsPerBlock: 47 }, { numBlocks: 14, dataCodewordsPerBlock: 48 }] },
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 11, dataCodewordsPerBlock: 24 }, { numBlocks: 14, dataCodewordsPerBlock: 25 }] },
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 16, dataCodewordsPerBlock: 15 }, { numBlocks: 14, dataCodewordsPerBlock: 16 }] }
    ]},
    { number: 24, errorCorrectionLevels: [
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 6, dataCodewordsPerBlock: 117 }, { numBlocks: 4, dataCodewordsPerBlock: 118 }] },
      { ecCodewordsPerBlock: 28, ecBlocks: [{ numBlocks: 6, dataCodewordsPerBlock: 45 }, { numBlocks: 14, dataCodewordsPerBlock: 46 }] },
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 11, dataCodewordsPerBlock: 24 }, { numBlocks: 16, dataCodewordsPerBlock: 25 }] },
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 30, dataCodewordsPerBlock: 16 }, { numBlocks: 2, dataCodewordsPerBlock: 17 }] }
    ]},
    { number: 25, errorCorrectionLevels: [
      { ecCodewordsPerBlock: 26, ecBlocks: [{ numBlocks: 8, dataCodewordsPerBlock: 106 }, { numBlocks: 4, dataCodewordsPerBlock: 107 }] },
      { ecCodewordsPerBlock: 28, ecBlocks: [{ numBlocks: 8, dataCodewordsPerBlock: 47 }, { numBlocks: 13, dataCodewordsPerBlock: 48 }] },
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 7, dataCodewordsPerBlock: 24 }, { numBlocks: 22, dataCodewordsPerBlock: 25 }] },
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 22, dataCodewordsPerBlock: 15 }, { numBlocks: 13, dataCodewordsPerBlock: 16 }] }
    ]},
    { number: 26, errorCorrectionLevels: [
      { ecCodewordsPerBlock: 28, ecBlocks: [{ numBlocks: 10, dataCodewordsPerBlock: 114 }, { numBlocks: 2, dataCodewordsPerBlock: 115 }] },
      { ecCodewordsPerBlock: 28, ecBlocks: [{ numBlocks: 19, dataCodewordsPerBlock: 46 }, { numBlocks: 4, dataCodewordsPerBlock: 47 }] },
      { ecCodewordsPerBlock: 28, ecBlocks: [{ numBlocks: 28, dataCodewordsPerBlock: 22 }, { numBlocks: 6, dataCodewordsPerBlock: 23 }] },
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 33, dataCodewordsPerBlock: 16 }, { numBlocks: 4, dataCodewordsPerBlock: 17 }] }
    ]},
    { number: 27, errorCorrectionLevels: [
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 8, dataCodewordsPerBlock: 122 }, { numBlocks: 4, dataCodewordsPerBlock: 123 }] },
      { ecCodewordsPerBlock: 28, ecBlocks: [{ numBlocks: 22, dataCodewordsPerBlock: 45 }, { numBlocks: 3, dataCodewordsPerBlock: 46 }] },
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 8, dataCodewordsPerBlock: 23 }, { numBlocks: 26, dataCodewordsPerBlock: 24 }] },
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 12, dataCodewordsPerBlock: 15 }, { numBlocks: 28, dataCodewordsPerBlock: 16 }] }
    ]},
    { number: 28, errorCorrectionLevels: [
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 3, dataCodewordsPerBlock: 117 }, { numBlocks: 10, dataCodewordsPerBlock: 118 }] },
      { ecCodewordsPerBlock: 28, ecBlocks: [{ numBlocks: 3, dataCodewordsPerBlock: 45 }, { numBlocks: 23, dataCodewordsPerBlock: 46 }] },
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 4, dataCodewordsPerBlock: 24 }, { numBlocks: 31, dataCodewordsPerBlock: 25 }] },
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 11, dataCodewordsPerBlock: 15 }, { numBlocks: 31, dataCodewordsPerBlock: 16 }] }
    ]},
    { number: 29, errorCorrectionLevels: [
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 7, dataCodewordsPerBlock: 116 }, { numBlocks: 7, dataCodewordsPerBlock: 117 }] },
      { ecCodewordsPerBlock: 28, ecBlocks: [{ numBlocks: 21, dataCodewordsPerBlock: 45 }, { numBlocks: 7, dataCodewordsPerBlock: 46 }] },
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 1, dataCodewordsPerBlock: 23 }, { numBlocks: 37, dataCodewordsPerBlock: 24 }] },
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 19, dataCodewordsPerBlock: 15 }, { numBlocks: 26, dataCodewordsPerBlock: 16 }] }
    ]},
    { number: 30, errorCorrectionLevels: [
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 5, dataCodewordsPerBlock: 115 }, { numBlocks: 10, dataCodewordsPerBlock: 116 }] },
      { ecCodewordsPerBlock: 28, ecBlocks: [{ numBlocks: 19, dataCodewordsPerBlock: 47 }, { numBlocks: 10, dataCodewordsPerBlock: 48 }] },
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 15, dataCodewordsPerBlock: 24 }, { numBlocks: 25, dataCodewordsPerBlock: 25 }] },
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 23, dataCodewordsPerBlock: 15 }, { numBlocks: 28, dataCodewordsPerBlock: 16 }] }
    ]},
    { number: 31, errorCorrectionLevels: [
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 13, dataCodewordsPerBlock: 115 }, { numBlocks: 3, dataCodewordsPerBlock: 116 }] },
      { ecCodewordsPerBlock: 28, ecBlocks: [{ numBlocks: 2, dataCodewordsPerBlock: 46 }, { numBlocks: 29, dataCodewordsPerBlock: 47 }] },
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 42, dataCodewordsPerBlock: 24 }, { numBlocks: 1, dataCodewordsPerBlock: 25 }] },
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 23, dataCodewordsPerBlock: 15 }, { numBlocks: 28, dataCodewordsPerBlock: 16 }] }
    ]},
    { number: 32, errorCorrectionLevels: [
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 17, dataCodewordsPerBlock: 115 }] },
      { ecCodewordsPerBlock: 28, ecBlocks: [{ numBlocks: 10, dataCodewordsPerBlock: 46 }, { numBlocks: 23, dataCodewordsPerBlock: 47 }] },
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 10, dataCodewordsPerBlock: 24 }, { numBlocks: 35, dataCodewordsPerBlock: 25 }] },
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 19, dataCodewordsPerBlock: 15 }, { numBlocks: 35, dataCodewordsPerBlock: 16 }] }
    ]}
    ,{ number: 33, errorCorrectionLevels: [
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 17, dataCodewordsPerBlock: 115 }, { numBlocks: 1, dataCodewordsPerBlock: 116 }] },
      { ecCodewordsPerBlock: 28, ecBlocks: [{ numBlocks: 14, dataCodewordsPerBlock: 46 }, { numBlocks: 21, dataCodewordsPerBlock: 47 }] },
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 29, dataCodewordsPerBlock: 24 }, { numBlocks: 19, dataCodewordsPerBlock: 25 }] },
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 11, dataCodewordsPerBlock: 15 }, { numBlocks: 46, dataCodewordsPerBlock: 16 }] }
    ]},
    { number: 34, errorCorrectionLevels: [
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 13, dataCodewordsPerBlock: 115 }, { numBlocks: 6, dataCodewordsPerBlock: 116 }] },
      { ecCodewordsPerBlock: 28, ecBlocks: [{ numBlocks: 14, dataCodewordsPerBlock: 46 }, { numBlocks: 23, dataCodewordsPerBlock: 47 }] },
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 44, dataCodewordsPerBlock: 24 }, { numBlocks: 7, dataCodewordsPerBlock: 25 }] },
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 59, dataCodewordsPerBlock: 16 }, { numBlocks: 1, dataCodewordsPerBlock: 17 }] }
    ]},
    { number: 35, errorCorrectionLevels: [
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 12, dataCodewordsPerBlock: 121 }, { numBlocks: 7, dataCodewordsPerBlock: 122 }] },
      { ecCodewordsPerBlock: 28, ecBlocks: [{ numBlocks: 12, dataCodewordsPerBlock: 47 }, { numBlocks: 26, dataCodewordsPerBlock: 48 }] },
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 39, dataCodewordsPerBlock: 24 }, { numBlocks: 14, dataCodewordsPerBlock: 25 }] },
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 22, dataCodewordsPerBlock: 15 }, { numBlocks: 41, dataCodewordsPerBlock: 16 }] }
    ]},
    { number: 36, errorCorrectionLevels: [
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 6, dataCodewordsPerBlock: 121 }, { numBlocks: 14, dataCodewordsPerBlock: 122 }] },
      { ecCodewordsPerBlock: 28, ecBlocks: [{ numBlocks: 6, dataCodewordsPerBlock: 47 }, { numBlocks: 34, dataCodewordsPerBlock: 48 }] },
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 46, dataCodewordsPerBlock: 24 }, { numBlocks: 10, dataCodewordsPerBlock: 25 }] },
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 2, dataCodewordsPerBlock: 15 }, { numBlocks: 64, dataCodewordsPerBlock: 16 }] }
    ]},
    { number: 37, errorCorrectionLevels: [
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 17, dataCodewordsPerBlock: 122 }, { numBlocks: 4, dataCodewordsPerBlock: 123 }] },
      { ecCodewordsPerBlock: 28, ecBlocks: [{ numBlocks: 29, dataCodewordsPerBlock: 46 }, { numBlocks: 14, dataCodewordsPerBlock: 47 }] },
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 49, dataCodewordsPerBlock: 24 }, { numBlocks: 10, dataCodewordsPerBlock: 25 }] },
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 24, dataCodewordsPerBlock: 15 }, { numBlocks: 46, dataCodewordsPerBlock: 16 }] }
    ]},
    { number: 38, errorCorrectionLevels: [
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 4, dataCodewordsPerBlock: 122 }, { numBlocks: 18, dataCodewordsPerBlock: 123 }] },
      { ecCodewordsPerBlock: 28, ecBlocks: [{ numBlocks: 13, dataCodewordsPerBlock: 46 }, { numBlocks: 32, dataCodewordsPerBlock: 47 }] },
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 48, dataCodewordsPerBlock: 24 }, { numBlocks: 14, dataCodewordsPerBlock: 25 }] },
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 42, dataCodewordsPerBlock: 15 }, { numBlocks: 32, dataCodewordsPerBlock: 16 }] }
    ]},
    { number: 39, errorCorrectionLevels: [
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 20, dataCodewordsPerBlock: 117 }, { numBlocks: 4, dataCodewordsPerBlock: 118 }] },
      { ecCodewordsPerBlock: 28, ecBlocks: [{ numBlocks: 40, dataCodewordsPerBlock: 47 }, { numBlocks: 7, dataCodewordsPerBlock: 48 }] },
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 43, dataCodewordsPerBlock: 24 }, { numBlocks: 22, dataCodewordsPerBlock: 25 }] },
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 10, dataCodewordsPerBlock: 15 }, { numBlocks: 67, dataCodewordsPerBlock: 16 }] }
    ]},
    { number: 40, errorCorrectionLevels: [
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 19, dataCodewordsPerBlock: 118 }, { numBlocks: 6, dataCodewordsPerBlock: 119 }] },
      { ecCodewordsPerBlock: 28, ecBlocks: [{ numBlocks: 18, dataCodewordsPerBlock: 47 }, { numBlocks: 31, dataCodewordsPerBlock: 48 }] },
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 34, dataCodewordsPerBlock: 24 }, { numBlocks: 34, dataCodewordsPerBlock: 25 }] },
      { ecCodewordsPerBlock: 30, ecBlocks: [{ numBlocks: 20, dataCodewordsPerBlock: 15 }, { numBlocks: 61, dataCodewordsPerBlock: 16 }] }
    ]}
  ];
  class BitStream {
    constructor(bytes) {
      this.bytes = bytes;
      this.byteOffset = 0;
      this.bitOffset = 0;
    }
    readBits(numBits) {
      if (numBits < 1 || numBits > 32 || numBits > this.available()) {
        throw new Error('Cannot read ' + numBits + ' bits');
      }
      let result = 0;
      if (this.bitOffset > 0) {
        const bitsLeft = 8 - this.bitOffset;
        const toRead = numBits < bitsLeft ? numBits : bitsLeft;
        const bitsToNotRead = bitsLeft - toRead;
        const mask = (0xFF >> (8 - toRead)) << bitsToNotRead;
        result = (this.bytes[this.byteOffset] & mask) >> bitsToNotRead;
        numBits -= toRead;
        this.bitOffset += toRead;
        if (this.bitOffset === 8) {
          this.bitOffset = 0;
          this.byteOffset++;
        }
      }
      while (numBits >= 8) {
        result = (result << 8) | (this.bytes[this.byteOffset] & 0xFF);
        this.byteOffset++;
        numBits -= 8;
      }
      if (numBits > 0) {
        const bitsToNotRead = 8 - numBits;
        const mask = (0xFF >> bitsToNotRead) << bitsToNotRead;
        result = (result << numBits) | ((this.bytes[this.byteOffset] & mask) >> bitsToNotRead);
        this.bitOffset += numBits;
      }
      return result;
    }
    available() {
      return 8 * (this.bytes.length - this.byteOffset) - this.bitOffset;
    }
  }

  const ModeBits = {
    TERMINATOR: 0x0,
    NUMERIC: 0x1,
    ALPHANUMERIC: 0x2,
    BYTE: 0x4,
    KANJI: 0x8,
    ECI: 0x7
  };

  function characterCountBits(mode, version) {
    const size = version <= 9 ? 0 : version <= 26 ? 1 : 2;
    switch (mode) {
      case ModeBits.NUMERIC:
        return [10, 12, 14][size];
      case ModeBits.ALPHANUMERIC:
        return [9, 11, 13][size];
      case ModeBits.BYTE:
        return [8, 16, 16][size];
      case ModeBits.KANJI:
        return [8, 10, 12][size];
      default:
        return 0;
    }
  }

  function parseSegments(bytes, version) {
    const stream = new BitStream(bytes);
    const segments = [];
    let bitsConsumed = 0;
    let terminatorBits = 0;

    while (stream.available() >= 4) {
      const mode = stream.readBits(4);
      bitsConsumed += 4;
      if (mode === ModeBits.TERMINATOR) {
        terminatorBits = 4;
        break;
      }
      if (mode === ModeBits.ECI) {
        let assignmentNumber = -1;
        let extraBits = 0;
        const first = stream.readBits(1);
        extraBits += 1;
        if (first === 0) {
          assignmentNumber = stream.readBits(7);
          extraBits += 7;
        } else {
          const second = stream.readBits(1);
          extraBits += 1;
          if (second === 0) {
            assignmentNumber = stream.readBits(14);
            extraBits += 14;
          } else {
            const third = stream.readBits(1);
            extraBits += 1;
            if (third === 0) {
              assignmentNumber = stream.readBits(21);
              extraBits += 21;
            }
          }
        }
        bitsConsumed += extraBits;
        segments.push({
          mode: 'eci',
          assignmentNumber,
          bitLength: 4 + extraBits,
          dataBits: extraBits,
          countBits: 0,
          charCount: null
        });
        continue;
      }
      const countBits = characterCountBits(mode, version);
      const charCount = countBits ? stream.readBits(countBits) : 0;
      bitsConsumed += countBits;
      let dataBits = 0;
      if (mode === ModeBits.NUMERIC) {
        let remaining = charCount;
        while (remaining >= 3) {
          stream.readBits(10);
          dataBits += 10;
          remaining -= 3;
        }
        if (remaining === 2) {
          stream.readBits(7);
          dataBits += 7;
        } else if (remaining === 1) {
          stream.readBits(4);
          dataBits += 4;
        }
      } else if (mode === ModeBits.ALPHANUMERIC) {
        let remaining = charCount;
        while (remaining >= 2) {
          stream.readBits(11);
          dataBits += 11;
          remaining -= 2;
        }
        if (remaining === 1) {
          stream.readBits(6);
          dataBits += 6;
        }
      } else if (mode === ModeBits.BYTE) {
        const bitsToRead = charCount * 8;
        for (let i = 0; i < charCount; i++) {
          stream.readBits(8);
        }
        dataBits += bitsToRead;
      } else if (mode === ModeBits.KANJI) {
        for (let i = 0; i < charCount; i++) {
          stream.readBits(13);
        }
        dataBits += charCount * 13;
      } else {
        // Unknown mode, bail out
        break;
      }
      bitsConsumed += dataBits;
      segments.push({
        mode: mode === ModeBits.NUMERIC ? 'numeric' : mode === ModeBits.ALPHANUMERIC ? 'alphanumeric' : mode === ModeBits.BYTE ? 'byte' : 'kanji',
        charCount,
        bitLength: 4 + countBits + dataBits,
        dataBits,
        countBits
      });
    }

    return {
      segments,
      bitsConsumed,
      terminatorBits
    };
  }

  function determineErrorCorrection(versionNumber, dataCodewords) {
    const versionInfo = VERSIONS.find(v => v.number === versionNumber);
    if (!versionInfo) {
      return null;
    }
    for (let levelIndex = 0; levelIndex < versionInfo.errorCorrectionLevels.length; levelIndex++) {
      const level = versionInfo.errorCorrectionLevels[levelIndex];
      const total = level.ecBlocks.reduce((sum, block) => sum + block.numBlocks * block.dataCodewordsPerBlock, 0);
      if (total === dataCodewords) {
        return { levelIndex, level };
      }
    }
    return null;
  }

  function describeBlocks(level) {
    return level.ecBlocks.map(block => `${block.numBlocks}×${block.dataCodewordsPerBlock}`).join(' + ');
  }
  function buildLocationFromResult(result, dimension) {
    const loc = result.location;
    const alignment = loc.bottomRightAlignmentPattern || loc.bottomRightCorner || loc.bottomRightFinderPattern || loc.bottomRightCorner;
    return {
      topLeft: loc.topLeftFinderPattern,
      topRight: loc.topRightFinderPattern,
      bottomLeft: loc.bottomLeftFinderPattern,
      alignmentPattern: alignment,
      dimension
    };
  }

  function chunksToDisplay(parsed, decodedChunks) {
    const displays = [];
    let chunkIndex = 0;
    for (const seg of parsed.segments) {
      const chunk = decodedChunks[chunkIndex];
      const base = {
        mode: seg.mode,
        bitLength: seg.bitLength,
        dataBits: seg.dataBits,
        countBits: seg.countBits,
        charCount: seg.charCount,
        assignmentNumber: seg.assignmentNumber ?? null,
        content: null,
        extra: null
      };
      if (seg.mode === 'eci') {
        base.content = `ECI assignment: ${seg.assignmentNumber}`;
        base.extra = null;
        displays.push(base);
        chunkIndex++; // jsQR includes eci chunk
        continue;
      }
      if (!chunk) {
        base.content = '(chunk unavailable)';
        displays.push(base);
        continue;
      }
      if (seg.mode === 'byte') {
        const bytes = chunk.bytes || [];
        const hex = bytes.map(b => b.toString(16).padStart(2, '0')).join(' ');
        base.content = chunk.text || '(byte data)';
        base.extra = `Bytes (${bytes.length}): ${hex}`;
      } else if (seg.mode === 'numeric' || seg.mode === 'alphanumeric' || seg.mode === 'kanji') {
        base.content = chunk.text || '';
      }
      displays.push(base);
      chunkIndex++;
    }
    return displays;
  }

  function summarizePadding(bytes, bitsConsumed) {
    const totalBits = bytes.length * 8;
    const padBits = Math.max(0, totalBits - bitsConsumed);
    const usedBytes = Math.ceil(bitsConsumed / 8);
    const intraBytePadding = usedBytes * 8 - bitsConsumed;
    const padBytes = bytes.slice(usedBytes);
    return {
      padBits,
      intraBytePadding,
      padByteCount: padBytes.length,
      padByteValues: padBytes.map(b => '0x' + b.toString(16).padStart(2, '0'))
    };
  }
  const VERSION_LEVEL_SEQUENCE = ['L', 'M', 'Q', 'H'];
  function analyzeImage(imageData, sourceLabel) {
    if (typeof jsQR !== 'function') {
      statusEl.textContent = 'jsQR library failed to load.';
      return;
    }
    const { data, width, height } = imageData;
    const result = jsQR(data, width, height, { inversionAttempts: 'attemptBoth' });
    if (!result) {
      statusEl.textContent = 'No QR code found in the provided image.';
      detailsEl.textContent = '';
      return;
    }

    const dimension = 17 + 4 * result.version;
    const binMatrix = binarize(data, width, height);
    const versionInfo = VERSIONS.find(v => v.number === result.version);
    let formatInfo = null;
    try {
      const extractedMatrix = extractMatrix(binMatrix, buildLocationFromResult(result, dimension));
      formatInfo = readFormatInformation(extractedMatrix);
    } catch (err) {
      console.warn('Failed to read format information', err);
    }

    const binaryBytes = new Uint8Array(result.binaryData);
    const parsed = parseSegments(binaryBytes, result.version);
    const segmentDisplays = chunksToDisplay(parsed, result.chunks || []);
    const paddingInfo = summarizePadding(Array.from(binaryBytes), parsed.bitsConsumed);

    const formatLevel = formatInfo ? ERROR_CORRECTION_MAP[formatInfo.errorCorrectionLevel] : null;
    const determined = determineErrorCorrection(result.version, result.binaryData.length);
    const determinedLevel = determined ? VERSION_LEVEL_SEQUENCE[determined.levelIndex] : null;
    const errorCorrectionLetter = formatLevel || determinedLevel || 'Unknown';
    const errorCorrectionSummary = ERROR_CORRECTION_INFO[errorCorrectionLetter] || '';

    const formatIndex = formatLevel ? VERSION_LEVEL_SEQUENCE.indexOf(formatLevel) : -1;
    const levelInfo = determined ? determined.level : (formatIndex >= 0 && versionInfo ? versionInfo.errorCorrectionLevels[formatIndex] : null);

    const maskPattern = formatInfo ? formatInfo.dataMask : null;
    const maskDescription = maskPattern != null ? maskDescriptions[maskPattern] : 'Unknown';

    const totalBits = result.binaryData.length * 8;

    const parts = [];
    parts.push(`Source: ${sourceLabel}`);
    parts.push('---');
    parts.push(`Version: ${result.version} (dimension ${dimension}×${dimension})`);
    parts.push(`Mask pattern: ${maskPattern != null ? maskPattern : 'Unknown'}${maskPattern != null ? ` – ${maskDescription}` : ''}`);
    if (errorCorrectionLetter !== 'Unknown') {
      const blockSummary = levelInfo ? describeBlocks(levelInfo) : 'unknown blocks';
      const ecCodewords = levelInfo ? levelInfo.ecCodewordsPerBlock : 'unknown';
      parts.push(`Error correction: Level ${errorCorrectionLetter}${errorCorrectionSummary ? ` (${errorCorrectionSummary})` : ''}`);
      parts.push(`  Data codewords: ${result.binaryData.length}`);
      parts.push(`  EC codewords per block: ${ecCodewords}`);
      parts.push(`  Block distribution: ${blockSummary}`);
    } else {
      parts.push('Error correction: Unknown');
    }

    parts.push('');
    parts.push('Data segments:');
    segmentDisplays.forEach((seg, index) => {
      parts.push(` ${index + 1}. Mode: ${seg.mode}`);
      if (seg.charCount != null) {
        parts.push(`    Character count: ${seg.charCount} (length field: ${seg.countBits} bits)`);
      }
      parts.push(`    Data bits: ${seg.dataBits} (total segment bits: ${seg.bitLength})`);
      if (seg.content) {
        parts.push(`    Data: ${seg.content}`);
      }
      if (seg.extra) {
        parts.push(`    ${seg.extra}`);
      }
    });

    parts.push('');
    parts.push('Padding and terminator:');
    parts.push(`  Total data bits: ${totalBits}`);
    parts.push(`  Bits consumed by segments (including mode/count bits): ${parsed.bitsConsumed}`);
    parts.push(`  Terminator bits used: ${parsed.terminatorBits}`);
    parts.push(`  Remaining pad bits: ${paddingInfo.padBits}`);
    parts.push(`  Padding within last data byte: ${paddingInfo.intraBytePadding}`);
    parts.push(`  Pad bytes (${paddingInfo.padByteCount}): ${paddingInfo.padByteValues.join(' ') || '(none)'}`);

    statusEl.textContent = 'QR code decoded successfully.';
    detailsEl.textContent = parts.join('\n');
  }
  async function blobToImageData(blob) {
    if (window.createImageBitmap) {
      const bitmap = await createImageBitmap(blob).catch(() => null);
      if (bitmap) {
        workCanvas.width = bitmap.width;
        workCanvas.height = bitmap.height;
        ctx.drawImage(bitmap, 0, 0);
        const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
        if (bitmap.close) {
          bitmap.close();
        }
        return data;
      }
    }
    return await new Promise((resolve) => {
      const img = new Image();
      const cleanup = () => {
        if (img.src.startsWith('blob:')) {
          URL.revokeObjectURL(img.src);
        }
      };
      img.onload = () => {
        workCanvas.width = img.naturalWidth;
        workCanvas.height = img.naturalHeight;
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, img.naturalWidth, img.naturalHeight);
        cleanup();
        resolve(data);
      };
      img.onerror = () => {
        cleanup();
        resolve(null);
      };
      img.src = URL.createObjectURL(blob);
    });
  }

  async function processBlob(blob, label) {
    if (!blob) {
      statusEl.textContent = 'No image found in clipboard.';
      return;
    }
    const imageData = await blobToImageData(blob);
    if (!imageData) {
      statusEl.textContent = 'Unable to read image data.';
      return;
    }
    analyzeImage(imageData, label);
  }

  fileInput.addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) {
      return;
    }
    await processBlob(file, `File: ${file.name}`);
    fileInput.value = '';
  });

  async function attemptClipboardRead() {
    pasteStatusEl.textContent = ' Requesting clipboard...';
    try {
      if (navigator.permissions && navigator.permissions.query) {
        try {
          const permission = await navigator.permissions.query({ name: 'clipboard-read' });
          if (permission.state === 'denied') {
            pasteStatusEl.textContent = ' Clipboard access denied. Use Ctrl+V after clicking this page.';
          }
        } catch (err) {
          // Ignore unsupported permissions API
        }
      }
      if (!navigator.clipboard || !navigator.clipboard.read) {
        throw new Error('Direct clipboard read not supported');
      }
      const items = await navigator.clipboard.read();
      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            const blob = await item.getType(type);
            awaitingManualPaste = false;
            clearTimeout(manualPasteTimer);
            pasteStatusEl.textContent = '';
            await processBlob(blob, 'Clipboard image');
            return true;
          }
        }
      }
      pasteStatusEl.textContent = ' Clipboard did not contain an image.';
      return false;
    } catch (err) {
      console.warn('Clipboard read failed', err);
      pasteStatusEl.textContent = ' Press Ctrl+V now to paste an image.';
      awaitingManualPaste = true;
      clearTimeout(manualPasteTimer);
      manualPasteTimer = setTimeout(() => {
        awaitingManualPaste = false;
        pasteStatusEl.textContent = ' Paste timed out. Try again.';
      }, 15000);
      return false;
    }
  }

  pasteButton.addEventListener('click', async () => {
    const succeeded = await attemptClipboardRead();
    if (!succeeded) {
      // Fallback to manual paste instructions handled via paste listener
    }
  });

  document.addEventListener('paste', (event) => {
    if (!awaitingManualPaste) {
      return;
    }
    const items = event.clipboardData && event.clipboardData.items;
    if (!items) {
      return;
    }
    for (const item of items) {
      if (item.type && item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (blob) {
          event.preventDefault();
          awaitingManualPaste = false;
          clearTimeout(manualPasteTimer);
          pasteStatusEl.textContent = '';
          processBlob(blob, 'Clipboard image');
          break;
        }
      }
    }
  });

  async function startCamera() {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      cameraPreview.srcObject = mediaStream;
      cameraPreview.style.display = 'block';
      cameraToggle.textContent = 'Stop camera';
      captureFrameButton.disabled = false;
      statusEl.textContent = 'Camera ready. Capture a frame to analyze it.';
    } catch (err) {
      console.error('Camera start failed', err);
      statusEl.textContent = 'Unable to access the camera.';
    }
  }

  function stopCamera() {
    if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop());
      mediaStream = null;
    }
    cameraPreview.srcObject = null;
    cameraPreview.style.display = 'none';
    cameraToggle.textContent = 'Start camera';
    captureFrameButton.disabled = true;
  }

  cameraToggle.addEventListener('click', () => {
    if (mediaStream) {
      stopCamera();
    } else {
      startCamera();
    }
  });

  captureFrameButton.addEventListener('click', () => {
    if (!mediaStream) {
      return;
    }
    const track = mediaStream.getVideoTracks()[0];
    if (!track) {
      statusEl.textContent = 'No video track available.';
      return;
    }
    if (window.ImageCapture) {
      const capture = new ImageCapture(track);
      capture.grabFrame().then(bitmap => {
        workCanvas.width = bitmap.width;
        workCanvas.height = bitmap.height;
        ctx.drawImage(bitmap, 0, 0);
        const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
        analyzeImage(imageData, 'Camera frame');
      }).catch(err => {
        console.error('Failed to capture frame', err);
        statusEl.textContent = 'Failed to capture a frame from the camera.';
      });
    } else {
      const settings = track.getSettings();
      const width = settings.width || cameraPreview.videoWidth;
      const height = settings.height || cameraPreview.videoHeight;
      if (!width || !height) {
        statusEl.textContent = 'Camera dimensions unavailable.';
        return;
      }
      workCanvas.width = width;
      workCanvas.height = height;
      ctx.drawImage(cameraPreview, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height);
      analyzeImage(imageData, 'Camera frame');
    }
  });
})();
