export interface LocalAnalysisResult {
  title: string;
  detectedMovement: string;
  mediumAndSurface: string;
  detectedEffects: string[];
  typographyAndFonts?: string;
  characterDesign?: string;
  environmentAndBackground: string;
  fullPrompt: string;
  styleOnlyPrompt: string;
  palette: { name: string; hex: string }[];
}

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

const PIGMENT_MAP: { name: string; r: number; g: number; b: number }[] = [
  { name: "obsidian black", r: 18, g: 18, b: 20 },
  { name: "charcoal slate", r: 48, g: 52, b: 58 },
  { name: "burnt umber", r: 78, g: 46, b: 30 },
  { name: "terracotta sienna", r: 162, g: 82, b: 54 },
  { name: "warm ochre", r: 206, g: 152, b: 68 },
  { name: "cadmium yellow", r: 232, g: 196, b: 56 },
  { name: "alizarin crimson", r: 146, g: 34, b: 48 },
  { name: "coral vermilion", r: 214, g: 84, b: 64 },
  { name: "dusty rose", r: 192, g: 136, b: 138 },
  { name: "blush cream", r: 232, g: 206, b: 196 },
  { name: "prussian blue", r: 26, g: 60, b: 108 },
  { name: "cobalt blue", r: 44, g: 92, b: 182 },
  { name: "cerulean sky", r: 126, g: 174, b: 214 },
  { name: "teal cyan", r: 48, g: 148, b: 156 },
  { name: "forest emerald", r: 34, g: 96, b: 68 },
  { name: "sage celadon", r: 128, g: 148, b: 116 },
  { name: "olive moss", r: 112, g: 118, b: 62 },
  { name: "violet plum", r: 110, g: 68, b: 128 },
  { name: "lavender mist", r: 168, g: 152, b: 196 },
  { name: "warm ivory", r: 238, g: 229, b: 210 },
  { name: "cool silver gray", r: 156, g: 160, b: 166 },
  { name: "chalk white", r: 246, g: 245, b: 242 },
];

function closestPigmentName(c: RgbColor): string {
  let best = PIGMENT_MAP[0].name;
  let bestDist = Infinity;
  for (const p of PIGMENT_MAP) {
    const dist =
      (c.r - p.r) ** 2 + (c.g - p.g) ** 2 + (c.b - p.b) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = p.name;
    }
  }
  return best;
}

function rgbToHex(c: RgbColor): string {
  const toHex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
  return `#${toHex(c.r)}${toHex(c.g)}${toHex(c.b)}`;
}

function rgbToHue(r: number, g: number, b: number): number {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  if (max === min) return 0;
  const d = max - min;
  let h = 0;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return h * 60;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function ramp(value: number, low: number, high: number): number {
  if (high === low) return value >= high ? 1 : 0;
  return clamp01((value - low) / (high - low));
}

export interface VisualMetrics {
  width: number;
  height: number;
  avgLum: number;
  contrastSpan: number;
  avgChroma: number;
  vividRatio: number;
  neonRatio: number;
  avgWarmth: number;
  darkRatio: number;
  brightRatio: number;
  flatRatio: number;
  sharpEdgeRatio: number;
  microTexture: number;
  centerVsBorderSharpness: number;
  centerVsBorderLum: number;
  topVsBottomLum: number;
  hueSpread: number;
  topColors: RgbColor[];
  // Effect & 3D/geometric/architectural metrics
  rgbSplitRatio: number;
  rgbSplitPolarity: number;
  strongRedEdges: number;
  scanlineRatio: number;
  dot8Ratio: number;
  tileFlatRange: number;
  blockFlatRatio: number;
  orthogonalEdgeRatio: number;
  grainRatio: number;
  bloomRatio: number;
  smoothGradRatio: number;
  specularPeakRatio: number;
  longHVLineScore: number;
  // Typography, character, and environment metrics
  typographyBandScore: number;
  typographyZone: "upper" | "middle" | "lower" | "none";
  hasLocalizedPortraitSkin: boolean;
  silhouetteFocus: number;
  centerVsPerimColorDist: number;
  topAvgLum: number;
  topCoolness: number;
  botAvgLum: number;
  botGreenBias: number;
  perimAvgLum: number;
  perimFlatRatio: number;
  perimSharpRatio: number;
}

export function measureImageMetrics(
  data: Uint8ClampedArray,
  sampleW: number,
  sampleH: number,
  naturalW: number,
  naturalH: number
): VisualMetrics {
  const totalPixels = sampleW * sampleH;
  const luminances = new Float32Array(totalPixels);
  const lumHist = new Uint32Array(256);
  const hueBins = new Uint32Array(12);
  const rowMean = new Float32Array(sampleH);
  const buckets = new Map<
    string,
    { sumR: number; sumG: number; sumB: number; count: number }
  >();

  let sumLum = 0;
  let sumChroma = 0;
  let vividCount = 0;
  let neonCount = 0;
  let sumWarmth = 0;
  let darkCount = 0;
  let brightCount = 0;
  let glowCoreCount = 0;

  let centerLumSum = 0;
  let centerCount = 0;
  let borderLumSum = 0;
  let borderCount = 0;

  let topLumSum = 0;
  let topCoolSum = 0;
  let topCount = 0;
  let botLumSum = 0;
  let botGreenSum = 0;
  let botCount = 0;

  let cR = 0, cG = 0, cB = 0, cN = 0;
  let pR = 0, pG = 0, pB = 0, pN = 0, perimLumSum = 0;

  let faceSkinCenter = 0, faceCenterN = 0;
  let faceSkinOuter = 0, faceOuterN = 0;

  for (let y = 0; y < sampleH; y++) {
    let rowSum = 0;
    for (let x = 0; x < sampleW; x++) {
      const i = y * sampleW + x;
      const idx = i * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      luminances[i] = lum;
      rowSum += lum;
      lumHist[Math.min(255, Math.max(0, Math.round(lum)))]++;
      sumLum += lum;
      if (lum < 50) darkCount++;
      if (lum > 205) brightCount++;
      if (lum > 232) glowCoreCount++;

      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const chroma = (maxC - minC) / 255;
      sumChroma += chroma;

      if (chroma > 0.34 && maxC > 95) vividCount++;
      if (
        chroma > 0.44 &&
        maxC > 140 &&
        (b > r * 1.15 || (r > 160 && b > 140 && g < 110) || (g > 175 && b > 165 && r < 110))
      ) {
        neonCount++;
      }

      if (chroma > 0.09) {
        const h = rgbToHue(r, g, b);
        hueBins[Math.min(11, Math.floor(h / 30))]++;
      }

      sumWarmth += r - b;

      const inCenter =
        x >= sampleW * 0.28 &&
        x <= sampleW * 0.72 &&
        y >= sampleH * 0.24 &&
        y <= sampleH * 0.74;
      const isPerim =
        x < sampleW * 0.18 ||
        x > sampleW * 0.82 ||
        y < sampleH * 0.16;

      if (inCenter) {
        centerLumSum += lum;
        centerCount++;
        cR += r; cG += g; cB += b; cN++;
      } else if (isPerim || y > sampleH * 0.84) {
        borderLumSum += lum;
        borderCount++;
      }

      if (isPerim) {
        perimLumSum += lum;
        pR += r; pG += g; pB += b; pN++;
      }

      if (y < sampleH * 0.28) {
        topLumSum += lum;
        topCoolSum += b - r;
        topCount++;
      } else if (y > sampleH * 0.72) {
        botLumSum += lum;
        botGreenSum += g - Math.max(r, b) * 0.86;
        botCount++;
      }

      // Localized portrait skin/warmth check (natural/illustrated skin tones in upper-middle center vs outer margins)
      if (y >= sampleH * 0.14 && y <= sampleH * 0.56) {
        const isSkinHue =
          r > 110 &&
          g >= r * 0.58 &&
          g <= r * 0.90 &&
          b >= 42 &&
          b <= g * 0.93 &&
          r - g >= 10 &&
          r - g <= 74 &&
          r - b <= 115 &&
          maxC - minC > 14;
        if (x >= sampleW * 0.32 && x <= sampleW * 0.68) {
          if (isSkinHue) faceSkinCenter++;
          faceCenterN++;
        } else if (x < sampleW * 0.16 || x > sampleW * 0.84) {
          if (isSkinHue) faceSkinOuter++;
          faceOuterN++;
        }
      }

      const qr = Math.round(r / 24) * 24;
      const qg = Math.round(g / 24) * 24;
      const qb = Math.round(b / 24) * 24;
      const key = `${qr},${qg},${qb}`;
      const existing = buckets.get(key);
      if (existing) {
        existing.sumR += r;
        existing.sumG += g;
        existing.sumB += b;
        existing.count += 1;
      } else {
        buckets.set(key, { sumR: r, sumG: g, sumB: b, count: 1 });
      }
    }
    rowMean[y] = rowSum / sampleW;
  }

  const centerVsPerimColorDist = Math.hypot(
    cR / Math.max(1, cN) - pR / Math.max(1, pN),
    cG / Math.max(1, cN) - pG / Math.max(1, pN),
    cB / Math.max(1, cN) - pB / Math.max(1, pN)
  );

  const skinCenterRatio = faceSkinCenter / Math.max(1, faceCenterN);
  const skinOuterRatio = faceSkinOuter / Math.max(1, faceOuterN);
  const hasLocalizedPortraitSkin =
    skinCenterRatio > 0.12 && skinCenterRatio > skinOuterRatio * 1.85;

  // Percentile contrast span (P95 - P05)
  let p05 = 0;
  let p95 = 255;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += lumHist[v];
    if (acc >= totalPixels * 0.05) {
      p05 = v;
      break;
    }
  }
  acc = 0;
  for (let v = 255; v >= 0; v--) {
    acc += lumHist[v];
    if (acc >= totalPixels * 0.05) {
      p95 = v;
      break;
    }
  }

  // Scanline detection: horizontal alternating row brightness oscillations
  let scanRows = 0;
  for (let y = 1; y < sampleH - 1; y++) {
    const osc = Math.abs(rowMean[y] - 0.5 * (rowMean[y - 1] + rowMean[y + 1]));
    const alt = (rowMean[y] - rowMean[y - 1]) * (rowMean[y] - rowMean[y + 1]) > 0;
    if (osc > 2.8 && alt) scanRows++;
  }

  // Edge, flat-region, micro-texture, block-flat, perimeter sharpness, and JPEG-resilient RGB split analysis
  let flatCount = 0;
  let blockFlatCount = 0;
  let sharpEdgeCount = 0;
  let fineTextureSum = 0;
  let centerEdgeSum = 0;
  let centerEdgeN = 0;
  let borderEdgeSum = 0;
  let borderEdgeN = 0;
  let perimFlatCount = 0;
  let perimSharpCount = 0;
  let perimInnerN = 0;

  let strongRedEdges = 0;
  let splitEdges = 0;
  let posSplits = 0;
  let negSplits = 0;
  let orthogonalEdges = 0;
  let diagonalEdges = 0;
  let smoothGradCount = 0;
  let specularPeakCount = 0;
  let grainCount = 0;

  for (let y = 1; y < sampleH - 1; y++) {
    for (let x = 1; x < sampleW - 1; x++) {
      const i = y * sampleW + x;
      const idx = i * 4;
      const idxRight = (i + 1) * 4;
      const idxDown = (i + sampleW) * 4;

      const colorDiff =
        Math.abs(data[idx] - data[idxRight]) +
        Math.abs(data[idx + 1] - data[idxRight + 1]) +
        Math.abs(data[idx + 2] - data[idxRight + 2]) +
        Math.abs(data[idx] - data[idxDown]) +
        Math.abs(data[idx + 1] - data[idxDown + 1]) +
        Math.abs(data[idx + 2] - data[idxDown + 2]);

      const gx = Math.abs(luminances[i + 1] - luminances[i - 1]);
      const gy = Math.abs(luminances[i + sampleW] - luminances[i - sampleW]);
      const mag = gx + gy;

      // Smooth 3D volumetric shading check: silky pixel-to-pixel (|d1| < 5) with clear continuous shading curve over 12px chord
      if (x >= 6 && x < sampleW - 6 && y >= 6 && y < sampleH - 6) {
        const d1x = Math.abs(luminances[i + 1] - luminances[i]);
        const d1y = Math.abs(luminances[i + sampleW] - luminances[i]);
        if (d1x < 5 && d1y < 5) {
          const chordX = Math.abs(luminances[i + 6] - luminances[i - 6]);
          const chordY = Math.abs(luminances[i + 6 * sampleW] - luminances[i - 6 * sampleW]);
          if (chordX + chordY >= 11) {
            smoothGradCount++;
          }
        }
        // Soft glossy 3D highlight dome (bright center on colored/curved surface dropping smoothly over 10px, not flat paper)
        if (luminances[i] > 214) {
          const ringAvg =
            0.25 *
            (luminances[i - 6] +
              luminances[i + 6] +
              luminances[i - 6 * sampleW] +
              luminances[i + 6 * sampleW]);
          const localChroma =
            (Math.max(data[idx], data[idx + 1], data[idx + 2]) -
              Math.min(data[idx], data[idx + 1], data[idx + 2])) /
            255;
          if (
            luminances[i] - ringAvg >= 16 &&
            luminances[i] - ringAvg <= 95 &&
            d1x < 5 &&
            d1y < 5 &&
            localChroma < 0.45
          ) {
            specularPeakCount++;
          }
        }
      }

      if ((gx > 38 && gy < 6) || (gy > 38 && gx < 6)) orthogonalEdges++;
      else if (gx > 18 && gy > 18) diagonalEdges++;

      if (colorDiff < 24) flatCount++;
      // JPEG-resilient flat interior (<6 luminance jump)
      if (
        Math.abs(luminances[i] - luminances[i + 1]) < 6 &&
        Math.abs(luminances[i] - luminances[i + sampleW]) < 6
      ) {
        blockFlatCount++;
      }
      if (mag > 42) sharpEdgeCount++;
      if (mag > 10 && mag <= 42) fineTextureSum += mag;

      if (x < sampleW * 0.18 || x > sampleW * 0.82 || y < sampleH * 0.16) {
        perimInnerN++;
        if (colorDiff < 24) perimFlatCount++;
        if (mag > 42) perimSharpCount++;
      }

      // Subtle 1px film grain check
      const c = luminances[i];
      const d1 = c - luminances[i - 1];
      const d2 = c - luminances[i + 1];
      const d3 = c - luminances[i - sampleW];
      const d4 = c - luminances[i + sampleW];
      if (
        ((d1 > 5 && d2 > 5 && d3 > 5 && d4 > 5) ||
          (d1 < -5 && d2 < -5 && d3 < -5 && d4 < -5)) &&
        Math.max(Math.abs(d1), Math.abs(d2), Math.abs(d3), Math.abs(d4)) < 18
      ) {
        grainCount++;
      }

      // JPEG-resilient RGB chromatic split check with shift-direction polarity (ignores round colored dots)
      if (x >= 13 && x < sampleW - 13 && y % 2 === 0) {
        const dR = data[(i + 1) * 4] - data[(i - 1) * 4];
        const dB = data[(i + 1) * 4 + 2] - data[(i - 1) * 4 + 2];
        if (Math.abs(dR) > 28) {
          strongRedEdges++;
          if (Math.abs(dB) < Math.abs(dR) * 0.45) {
            let foundK = 0;
            for (let dist = 3; dist <= 12; dist++) {
              const dBp = data[(i + dist + 1) * 4 + 2] - data[(i + dist - 1) * 4 + 2];
              if (Math.abs(dBp) > 22 && dBp * dR > 0) {
                foundK = dist;
                break;
              }
              const dBn = data[(i - dist + 1) * 4 + 2] - data[(i - dist - 1) * 4 + 2];
              if (Math.abs(dBn) > 22 && dBn * dR > 0) {
                foundK = -dist;
                break;
              }
            }
            if (foundK !== 0) {
              splitEdges++;
              if (foundK > 0) posSplits++;
              else negSplits++;
            }
          }
        }
      }

      const inCenter =
        x >= sampleW * 0.28 &&
        x <= sampleW * 0.72 &&
        y >= sampleH * 0.24 &&
        y <= sampleH * 0.74;
      if (inCenter) {
        centerEdgeSum += mag;
        centerEdgeN++;
      } else if (
        x < sampleW * 0.18 ||
        x > sampleW * 0.82 ||
        y < sampleH * 0.16 ||
        y > sampleH * 0.84
      ) {
        borderEdgeSum += mag;
        borderEdgeN++;
      }
    }
  }

  // Ring-uniform multi-scale dot detector (catches Ben-Day/halftone & stipples without triggering on chaotic brushstrokes or ink linework)
  let dot8Count = 0;
  let dot8SampleTotal = 0;
  for (let y = 7; y < sampleH - 7; y += 2) {
    for (let x = 7; x < sampleW - 7; x += 2) {
      const i = y * sampleW + x;
      const idx = i * 4;
      const r0 = data[idx];
      const g0 = data[idx + 1];
      const b0 = data[idx + 2];
      const c = luminances[i];
      let isDot = false;
      for (const rad of [2, 4, 6]) {
        const offsets = [
          -rad,
          rad,
          -rad * sampleW,
          rad * sampleW,
          -rad * sampleW - rad,
          -rad * sampleW + rad,
          rad * sampleW - rad,
          rad * sampleW + rad,
        ];
        let minRingLum = 255;
        let maxRingLum = 0;
        let minLumDiff = Infinity;
        let allPos = true;
        let allNeg = true;
        let minRgbDist = Infinity;

        for (const off of offsets) {
          const j = i + off;
          const rLum = luminances[j];
          if (rLum < minRingLum) minRingLum = rLum;
          if (rLum > maxRingLum) maxRingLum = rLum;
          const diff = c - rLum;
          if (diff <= 18) allPos = false;
          if (diff >= -18) allNeg = false;
          if (Math.abs(diff) < minLumDiff) minLumDiff = Math.abs(diff);

          const j4 = j * 4;
          const rgbD =
            Math.abs(r0 - data[j4]) +
            Math.abs(g0 - data[j4 + 1]) +
            Math.abs(b0 - data[j4 + 2]);
          if (rgbD < minRgbDist) minRgbDist = rgbD;
        }

        // The 8 surrounding ring points must belong to a relatively uniform background (spread < 38)
        if (maxRingLum - minRingLum < 38 && (allPos || allNeg || minRgbDist > 75)) {
          isDot = true;
          break;
        }
      }
      if (isDot) dot8Count++;
      dot8SampleTotal++;
    }
  }

  // 5x5 tile flat-heterogeneity (detects mixed-media collage combining flat cutouts + textured areas)
  const tileFlats: number[] = [];
  for (let ty = 0; ty < 5; ty++) {
    for (let tx = 0; tx < 5; tx++) {
      let tf = 0;
      let tn = 0;
      const y0 = Math.floor((ty * sampleH) / 5) + 1;
      const y1 = Math.floor(((ty + 1) * sampleH) / 5) - 1;
      const x0 = Math.floor((tx * sampleW) / 5) + 1;
      const x1 = Math.floor(((tx + 1) * sampleW) / 5) - 1;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = y * sampleW + x;
          if (
            Math.abs(luminances[i] - luminances[i + 1]) +
              Math.abs(luminances[i] - luminances[i + sampleW]) <
            10
          ) {
            tf++;
          }
          tn++;
        }
      }
      tileFlats.push(tf / Math.max(1, tn));
    }
  }
  const tileFlatRange = Math.max(...tileFlats) - Math.min(...tileFlats);

  // Full-frame sliding single-line typography/lettering check (tight line window + 1..26px glyph strokes + vertical stroke coherence)
  let bestTextScore = 0;
  let typographyZone: "upper" | "middle" | "lower" | "none" = "none";
  const bandHeight = Math.max(18, Math.floor(sampleH * 0.065));
  const stepY = Math.max(6, Math.floor(sampleH * 0.03));
  const xStart = Math.floor(sampleW * 0.14);
  const xEnd = Math.floor(sampleW * 0.86);
  const xSpan = Math.max(1, xEnd - xStart);

  for (let y0 = 0; y0 <= sampleH - bandHeight; y0 += stepY) {
    const y1 = y0 + bandHeight;
    const hist = new Uint32Array(32);
    let bandTotal = 0;
    let bandFlat = 0;
    let strokeRows = 0;

    for (let y = y0 + 1; y < y1 - 2; y++) {
      let shortStrokes = 0;
      let coherentEdges = 0;
      let rowFlat = 0;
      let lastSign = 0;
      let lastFlipX = -1;
      for (let x = xStart; x < xEnd; x++) {
        const i = y * sampleW + x;
        hist[Math.min(31, Math.floor(luminances[i] / 8))]++;
        const gx = luminances[i + 1] - luminances[i - 1];
        const gy = Math.abs(luminances[i + sampleW] - luminances[i - sampleW]);
        if (Math.abs(gx) < 5 && gy < 5) {
          bandFlat++;
          rowFlat++;
        }
        if (Math.abs(gx) > 44) {
          const s = gx > 0 ? 1 : -1;
          if (s !== lastSign) {
            if (lastFlipX >= 0) {
              const strokeW = x - lastFlipX;
              if (strokeW >= 1 && strokeW <= 26) {
                shortStrokes++;
                const nx0 = luminances[i + sampleW + 1] - luminances[i + sampleW - 1];
                const nx1 = luminances[i + sampleW + 2] - luminances[i + sampleW];
                const nx_1 = luminances[i + sampleW] - luminances[i + sampleW - 2];
                if (Math.max(nx0 * s, nx1 * s, nx_1 * s) > 20) coherentEdges++;
              }
            }
            lastFlipX = x;
            lastSign = s;
          }
        }
        bandTotal++;
      }
      if (
        shortStrokes >= 14 &&
        shortStrokes <= 64 &&
        coherentEdges >= Math.max(6, shortStrokes * 0.45) &&
        rowFlat > xSpan * 0.40
      ) {
        strokeRows++;
      }
    }

    let maxBucket = 0;
    for (let b = 0; b < 32; b++) if (hist[b] > maxBucket) maxBucket = hist[b];
    const domRatio = maxBucket / Math.max(1, bandTotal);
    const flatRatioBand = bandFlat / Math.max(1, bandTotal);
    const strokeRowRatio = strokeRows / Math.max(1, bandHeight - 3);

    if (domRatio >= 0.48 && flatRatioBand >= 0.50 && strokeRowRatio >= 0.24) {
      const score = domRatio * 0.5 + strokeRowRatio;
      if (score > bestTextScore) {
        bestTextScore = score;
        const midY = (y0 + y1) / 2;
        typographyZone =
          midY < sampleH * 0.34 ? "upper" : midY > sampleH * 0.66 ? "lower" : "middle";
      }
    }
  }

  // Central character / figure silhouette focus ratio (excluding top/bottom margins)
  let silCenterSum = 0;
  let silCenterN = 0;
  let silMarginSum = 0;
  let silMarginN = 0;
  for (let y = Math.floor(sampleH * 0.22); y < Math.floor(sampleH * 0.76); y++) {
    for (let x = 1; x < sampleW - 1; x++) {
      const i = y * sampleW + x;
      const e =
        Math.abs(luminances[i + 1] - luminances[i - 1]) +
        Math.abs(luminances[i + sampleW] - luminances[i - sampleW]);
      if (x >= sampleW * 0.30 && x <= sampleW * 0.70) {
        silCenterSum += e;
        silCenterN++;
      } else if (x < sampleW * 0.18 || x > sampleW * 0.82) {
        silMarginSum += e;
        silMarginN++;
      }
    }
  }
  const silhouetteFocus =
    silCenterSum / Math.max(1, silCenterN) /
    Math.max(1, silMarginSum / Math.max(1, silMarginN));
  const rgbSplitPolarity =
    Math.max(posSplits, negSplits) / Math.max(1, posSplits + negSplits);
  const orthogonalEdgeRatio =
    orthogonalEdges / Math.max(1, orthogonalEdges + diagonalEdges);

  // Architectural long contiguous horizontal & vertical structural line check
  let longHVRuns = 0;
  let hvTotalLines = 0;
  const minHRun = Math.max(38, Math.floor(sampleW * 0.11));
  const minVRun = Math.max(38, Math.floor(sampleH * 0.11));

  for (let y = 2; y < sampleH - 2; y += 3) {
    hvTotalLines++;
    let run = 0;
    let found = 0;
    for (let x = 1; x < sampleW - 1; x++) {
      const i = y * sampleW + x;
      const gy = Math.abs(luminances[i + sampleW] - luminances[i - sampleW]);
      const gx = Math.abs(luminances[i + 1] - luminances[i - 1]);
      if (gy > 18 && gx < 8) {
        run++;
      } else {
        if (run >= minHRun) found++;
        run = 0;
      }
    }
    if (run >= minHRun) found++;
    if (found > 0) longHVRuns += Math.min(2, found);
  }

  for (let x = 2; x < sampleW - 2; x += 3) {
    hvTotalLines++;
    let run = 0;
    let found = 0;
    for (let y = 1; y < sampleH - 1; y++) {
      const i = y * sampleW + x;
      const gx = Math.abs(luminances[i + 1] - luminances[i - 1]);
      const gy = Math.abs(luminances[i + sampleW] - luminances[i - sampleW]);
      if (gx > 18 && gy < 8) {
        run++;
      } else {
        if (run >= minVRun) found++;
        run = 0;
      }
    }
    if (run >= minVRun) found++;
    if (found > 0) longHVRuns += Math.min(2, found);
  }
  const longHVLineScore = longHVRuns / Math.max(1, hvTotalLines);

  const innerN = Math.max(1, (sampleW - 2) * (sampleH - 2));
  const centerEdgeAvg = centerEdgeSum / Math.max(1, centerEdgeN);
  const borderEdgeAvg = borderEdgeSum / Math.max(1, borderEdgeN);
  const activeHueBins = hueBins.filter((c) => c > totalPixels * 0.025).length;

  const sortedBuckets = [...buckets.values()].sort((a, b) => b.count - a.count);
  const topColors: RgbColor[] = [];
  for (const bucket of sortedBuckets) {
    const avg: RgbColor = {
      r: bucket.sumR / bucket.count,
      g: bucket.sumG / bucket.count,
      b: bucket.sumB / bucket.count,
    };
    const isDistinct = topColors.every(
      (c) =>
        Math.abs(c.r - avg.r) + Math.abs(c.g - avg.g) + Math.abs(c.b - avg.b) > 65
    );
    if (isDistinct) topColors.push(avg);
    if (topColors.length === 4) break;
  }

  return {
    width: naturalW,
    height: naturalH,
    avgLum: sumLum / totalPixels,
    contrastSpan: p95 - p05,
    avgChroma: sumChroma / totalPixels,
    vividRatio: vividCount / totalPixels,
    neonRatio: neonCount / totalPixels,
    avgWarmth: sumWarmth / totalPixels,
    darkRatio: darkCount / totalPixels,
    brightRatio: brightCount / totalPixels,
    flatRatio: flatCount / innerN,
    sharpEdgeRatio: sharpEdgeCount / innerN,
    microTexture: fineTextureSum / innerN,
    centerVsBorderSharpness: centerEdgeAvg / Math.max(1, borderEdgeAvg),
    centerVsBorderLum:
      centerLumSum / Math.max(1, centerCount) -
      borderLumSum / Math.max(1, borderCount),
    topVsBottomLum:
      topLumSum / Math.max(1, topCount) -
      botLumSum / Math.max(1, botCount),
    hueSpread: activeHueBins,
    topColors,
    rgbSplitRatio: splitEdges / Math.max(1, strongRedEdges),
    rgbSplitPolarity,
    strongRedEdges,
    scanlineRatio: scanRows / sampleH,
    dot8Ratio: dot8Count / Math.max(1, dot8SampleTotal),
    tileFlatRange,
    blockFlatRatio: blockFlatCount / innerN,
    orthogonalEdgeRatio,
    grainRatio: grainCount / innerN,
    bloomRatio: glowCoreCount / totalPixels,
    smoothGradRatio: smoothGradCount / innerN,
    specularPeakRatio: specularPeakCount / innerN,
    longHVLineScore,
    typographyBandScore: bestTextScore,
    typographyZone,
    hasLocalizedPortraitSkin,
    silhouetteFocus,
    centerVsPerimColorDist,
    topAvgLum: topLumSum / Math.max(1, topCount),
    topCoolness: topCoolSum / Math.max(1, topCount),
    botAvgLum: botLumSum / Math.max(1, botCount),
    botGreenBias: botGreenSum / Math.max(1, botCount),
    perimAvgLum: perimLumSum / Math.max(1, pN),
    perimFlatRatio: perimFlatCount / Math.max(1, perimInnerN),
    perimSharpRatio: perimSharpCount / Math.max(1, perimInnerN),
  };
}

function detectVisualEffects(m: VisualMetrics): string[] {
  const effects: string[] = [];

  if (m.rgbSplitRatio > 0.22 && m.strongRedEdges > 550 && m.rgbSplitPolarity > 0.65) {
    effects.push("RGB chromatic glitch split");
  }
  if (m.scanlineRatio > 0.44 && m.dot8Ratio < 0.16) {
    effects.push("horizontal CRT scanline distortion");
  }
  if (m.dot8Ratio > 0.025) {
    if (m.avgChroma > 0.14 && (m.vividRatio > 0.08 || m.flatRatio > 0.08)) {
      effects.push("halftone Ben-Day dots");
    } else {
      effects.push("stippled dot & pointillist texture");
    }
  }
  if (m.vividRatio > 0.15 && m.avgChroma > 0.21 && (m.flatRatio > 0.12 || m.dot8Ratio > 0.025)) {
    effects.push("pop-art bold color blocking");
  }
  if (m.tileFlatRange > 0.72 && m.blockFlatRatio > 0.22 && m.darkRatio < 0.55) {
    effects.push("mixed-media paper cutout collage");
  }
  if (
    m.dot8Ratio < 0.004 &&
    m.blockFlatRatio > 0.55 &&
    m.orthogonalEdgeRatio > 0.91 &&
    m.smoothGradRatio < 0.14 &&
    m.contrastSpan > 40 &&
    m.scanlineRatio < 0.15
  ) {
    effects.push("pixelated mosaic block grid");
  }
  if (
    m.longHVLineScore > 0.10 &&
    m.microTexture < 6.8 &&
    m.orthogonalEdgeRatio > 0.52 &&
    !(m.orthogonalEdgeRatio > 0.91 && m.blockFlatRatio > 0.55 && m.smoothGradRatio < 0.14)
  ) {
    effects.push("architectural linear perspective & structural geometry");
  }
  if (
    m.flatRatio > 0.34 &&
    m.microTexture < 7.5 &&
    m.dot8Ratio < 0.025 &&
    m.rgbSplitRatio <= 0.22 &&
    m.smoothGradRatio < 0.31
  ) {
    effects.push("geometric planar & clean angular forms");
  }
  if (m.smoothGradRatio >= 0.22 && m.sharpEdgeRatio < 0.14 && m.microTexture < 3.8) {
    if (m.specularPeakRatio > 0.005 || m.vividRatio > 0.12 || m.hasLocalizedPortraitSkin) {
      effects.push("Pixar-style 3D stylized CGI & soft subsurface shading");
    } else {
      effects.push("3D CGI volumetric rendering & smooth raytraced shading");
    }
    if (m.grainRatio > 0.0015 || m.specularPeakRatio < 0.008) {
      effects.push("sculpted matte clay & stop-motion tactile modeling");
    }
  }
  if (
    m.flatRatio < 0.14 &&
    m.sharpEdgeRatio < 0.24 &&
    m.contrastSpan > 125 &&
    m.dot8Ratio < 0.025 &&
    m.microTexture < 8.6 &&
    (m.centerVsBorderSharpness > 1.32 || m.smoothGradRatio > 0.18)
  ) {
    effects.push("photorealistic tonal depth & natural light realism");
  }
  if (m.bloomRatio > 0.05 && m.darkRatio > 0.22) {
    effects.push("luminous highlight bloom and glow halation");
  }
  if (m.centerVsBorderLum > 24 && m.darkRatio > 0.24) {
    effects.push("dramatic edge vignette");
  }
  if (m.grainRatio > 0.06 && m.dot8Ratio < 0.025 && m.flatRatio < 0.32) {
    effects.push("analog film and paper grain");
  }

  return effects;
}

interface StyleArchetype {
  name: string;
  medium: string;
  technique: string;
  score: (m: VisualMetrics) => number;
}

const ARCHETYPES: StyleArchetype[] = [
  {
    name: "Digital Glitch & Chromatic Distortion",
    medium: "Digital glitch art with separated RGB color channels and analog CRT video interference",
    technique: "offset red-blue chromatic aberration, scanline banding, and jagged horizontal slice tears",
    score: (m) =>
      (m.strongRedEdges > 550 && m.rgbSplitPolarity > 0.65
        ? ramp(m.rgbSplitRatio, 0.2, 0.45) * 12
        : 0) +
      (m.dot8Ratio < 0.16 ? ramp(m.scanlineRatio, 0.4, 0.7) * 5 : 0),
  },
  {
    name: "Pop Art & Halftone Screenprint",
    medium: "Vibrant silkscreened CMYK and primary acrylic inks with Ben-Day halftone dots on bright stock",
    technique: "bold high-contrast pop-art color blocking, graphic outlines, and visible halftone dot screening",
    score: (m) =>
      ramp(m.vividRatio, 0.12, 0.42) * 5 +
      ramp(m.avgChroma, 0.18, 0.38) * 3 +
      ramp(m.dot8Ratio, 0.022, 0.055) * 9 +
      ramp(m.flatRatio, 0.08, 0.35) * 1.5,
  },
  {
    name: "Mixed-Media Paper Collage & Cutout",
    medium: "Layered hand-cut matte construction paper and pasted printed fragments on archival board",
    technique: "sharp razor-cut planar shapes, contrasting surface textures, and overlapping cutout collage layers",
    score: (m) =>
      (m.darkRatio < 0.55 ? ramp(m.tileFlatRange, 0.68, 0.94) * 8.5 : 0) +
      ramp(m.blockFlatRatio, 0.22, 0.55) * 3.5 +
      ramp(m.flatRatio, 0.2, 0.5) * 1.5,
  },
  {
    name: "Pixel Art & Geometric Mosaic",
    medium: "Quantized digital pixel tiles or crisp tessellated color blocks",
    technique: "stepped orthogonal block boundaries, flat solid color cells, and deliberate low-resolution mosaic structure",
    score: (m) =>
      (m.dot8Ratio < 0.002 && m.orthogonalEdgeRatio > 0.91 && m.smoothGradRatio < 0.14 && m.contrastSpan > 40 ? 7 : 0) +
      ramp(m.blockFlatRatio, 0.5, 0.75) * 4.5 +
      ramp(3.2 - m.microTexture, 0, 2.5) * 2.5 +
      ramp(0.12 - m.scanlineRatio, 0, 0.1) * 1.5 -
      ramp(0.91 - m.orthogonalEdgeRatio, 0, 0.25) * 9 -
      ramp(m.smoothGradRatio, 0.14, 0.30) * 10,
  },
  {
    name: "Ink Linework & Monochrome Etching",
    medium: "Fine carbon ink penwork and crisp stippled or hatched shading on textured rag paper",
    technique: "precise ink contour lines, dense cross-hatched or stippled dot shading, and stark paper contrast",
    score: (m) =>
      ramp(0.055 - m.avgChroma, 0, 0.04) * 5 +
      ramp(m.sharpEdgeRatio, 0.18, 0.45) * 3 +
      ramp(m.brightRatio, 0.18, 0.5) * 2 -
      ramp(m.vividRatio, 0.01, 0.08) * 6,
  },
  {
    name: "Sumi-e Ink Wash & Tonal Charcoal",
    medium: "Diluted pine-soot ink washes and soft charcoal gradations on absorbent rice paper",
    technique: "expressive wet-in-wet ink blooms, soft tonal smoke fades, and open negative space",
    score: (m) =>
      ramp(0.06 - m.avgChroma, 0, 0.045) * 4.5 +
      ramp(0.32 - m.sharpEdgeRatio, 0, 0.22) * 2.5 +
      ramp(m.flatRatio, 0.2, 0.5) * 2 -
      ramp(m.vividRatio, 0.01, 0.08) * 6,
  },
  {
    name: "Pixar-Style 3D Animation & Stylized CGI",
    medium: "Stylized 3D CGI animation with soft subsurface scattering, smooth sculpted bevels, and expressive rim light",
    technique: "rounded volumetric forms, creamy specular highlights, bounce-lit color harmony, and zero harsh ink outlines",
    score: (m) =>
      m.smoothGradRatio >= 0.22 && m.sharpEdgeRatio < 0.14 && m.microTexture < 3.8
        ? ramp(m.smoothGradRatio, 0.2, 0.55) * 7.5 +
          ramp(m.specularPeakRatio, 0.004, 0.024) * 4 +
          ramp(m.vividRatio, 0.08, 0.35) * 3.5 +
          (m.hasLocalizedPortraitSkin ? 2.5 : 0)
        : 0,
  },
  {
    name: "Sculpted Clay & Stop-Motion Claymation",
    medium: "Handmade matte polymer clay or plasticine sculpture photographed under miniature studio lighting",
    technique: "soft rounded clay contours, subtle tactile matte surface grain, gentle ambient occlusion creases, and warm miniature depth",
    score: (m) =>
      m.smoothGradRatio >= 0.22 && m.sharpEdgeRatio < 0.14 && m.microTexture < 3.8
        ? ramp(m.smoothGradRatio, 0.2, 0.55) * 7 +
          ramp(0.012 - m.specularPeakRatio, 0, 0.01) * 3.5 +
          ramp(m.grainRatio, 0.001, 0.012) * 4.5
        : 0,
  },
  {
    name: "3D Digital Art & Volumetric CGI Render",
    medium: "Clean 3D CGI studio render with raytraced global illumination and smooth procedural shaders",
    technique: "smooth continuous gradient curvature, balanced specular reflections, crisp volumetric depth, and clean surface polish",
    score: (m) =>
      m.smoothGradRatio >= 0.22 && m.sharpEdgeRatio < 0.14 && m.microTexture < 3.8
        ? ramp(m.smoothGradRatio, 0.2, 0.55) * 7.5 +
          ramp(m.specularPeakRatio, 0.003, 0.02) * 3.5 +
          ramp(m.contrastSpan, 110, 200) * 2
        : 0,
  },
  {
    name: "Architectural Perspective & Structural Style",
    medium: "Architectural visualization or structural photography emphasizing clean facades, geometry, and spatial rhythm",
    technique: "crisp vertical and horizontal structural lines, perspective vanishing geometry, balanced material planes, and daylight shadows",
    score: (m) =>
      m.microTexture < 6.8 && m.orthogonalEdgeRatio > 0.52
        ? ramp(m.longHVLineScore, 0.09, 0.28) * 11 +
          ramp(6.8 - m.microTexture, 0, 3.8) * 2 +
          ramp(m.contrastSpan, 90, 180) * 1.5 -
          ramp(m.dot8Ratio, 0.02, 0.06) * 4
        : 0,
  },
  {
    name: "Photorealistic & Naturalistic Realism",
    medium: "True-to-life high-resolution photography or photorealistic rendering with authentic optical depth",
    technique: "continuous natural tonal transitions, organic surface detail, accurate light falloff, and natural atmosphere",
    score: (m) =>
      m.flatRatio < 0.14 && m.sharpEdgeRatio < 0.24
        ? ramp(0.14 - m.flatRatio, 0, 0.12) * 4.5 +
          ramp(m.contrastSpan, 125, 210) * 2.5 +
          ramp(m.centerVsBorderSharpness, 1.28, 2.0) * 2.5 -
          ramp(m.microTexture, 8.6, 12) * 4
        : 0,
  },
  {
    name: "Flat Vector & Geometric Poster Print",
    medium: "Matte flat color inks and geometric screenprint planes on smooth uncoated stock",
    technique: "clean geometric silhouettes, angular planar intersections, and unshaded flat color blocks",
    score: (m) =>
      ramp(m.flatRatio, 0.28, 0.55) * 5.5 +
      ramp(m.blockFlatRatio, 0.14, 0.4) * 2.5 +
      ramp(7.5 - m.microTexture, 0, 4.5) * 3 +
      ramp(5 - m.hueSpread, 0, 3) * 1.5 -
      ramp(m.darkRatio, 0.35, 0.7) * 3.5 -
      ramp(m.tileFlatRange, 0.65, 0.9) * 3 -
      (m.microTexture < 3.8 ? ramp(m.smoothGradRatio, 0.22, 0.45) * 9 : 0),
  },
  {
    name: "Woodblock Print & Ornate Ink Illustration",
    medium: "Carved keyblock ink outlines with flat mineral-pigment washes on warm laid paper",
    technique: "bold rhythmic ink contours, decorative linework, and balanced graphic color planes",
    score: (m) =>
      ramp(m.sharpEdgeRatio, 0.34, 0.58) * 4.5 +
      ramp(9.5 - m.microTexture, 0, 4) * 2.5 +
      ramp(m.flatRatio, 0.04, 0.26) * 2 +
      ramp(0.18 - m.avgChroma, 0, 0.1) * 1.5,
  },
  {
    name: "Cel-Shaded Digital Illustration",
    medium: "Crisp digital linework with clean cel-shaded color fills and luminous highlights",
    technique: "distinct dark contour line art, smooth stepped shading planes, and saturated color accents",
    score: (m) =>
      ramp(m.vividRatio, 0.08, 0.28) * 4 +
      ramp(m.flatRatio, 0.24, 0.5) * 2.5 +
      ramp(m.sharpEdgeRatio, 0.16, 0.38) * 2,
  },
  {
    name: "Chiaroscuro Baroque & Dramatic Low-Key",
    medium: "Deep walnut-oil glazes and sculpted warm impasto highlights on dark-primed linen",
    technique: "theatrical tenebrism, enveloping shadow voids, and warm raking directional light",
    score: (m) =>
      ramp(m.darkRatio, 0.35, 0.72) * 4.5 +
      ramp(95 - m.avgLum, 0, 60) * 3 +
      ramp(m.avgWarmth, 4, 30) * 1.5 +
      ramp(m.centerVsBorderLum, 6, 32) * 1.5 -
      ramp(m.neonRatio, 0.03, 0.14) * 5,
  },
  {
    name: "Neon & Nocturnal Chromatic Lighting",
    medium: "Luminous digital illustration or night photography with saturated specular glow",
    technique: "deep nocturnal shadows pierced by electric high-chroma cyan, violet, or magenta reflections",
    score: (m) =>
      ramp(m.neonRatio, 0.03, 0.18) * 6 +
      ramp(m.vividRatio, 0.08, 0.32) * 2.5 +
      ramp(m.darkRatio, 0.22, 0.58) * 2 -
      ramp(m.dot8Ratio, 0.08, 0.15) * 5 -
      ramp(m.avgLum, 120, 175) * 3,
  },
  {
    name: "Soft Watercolor & Luminous Gouache",
    medium: "Translucent watercolor washes and delicate matte gouache on cold-press cotton paper",
    technique: "airy wet-on-wet pigment bleeds, bright unpainted paper highlights, and gentle feathered edges",
    score: (m) =>
      ramp(m.avgLum, 152, 210) * 4 +
      ramp(m.brightRatio, 0.22, 0.55) * 3 +
      ramp(0.26 - m.sharpEdgeRatio, 0, 0.18) * 2.5 +
      ramp(0.1 - m.darkRatio, 0, 0.09) * 1.5 -
      ramp(m.flatRatio, 0.3, 0.52) * 4,
  },
  {
    name: "Impressionism & Painterly Impasto",
    medium: "Broken alla-prima oil brushstrokes and tactile pigment dabs on textured canvas",
    technique: "dense visible brushwork, lively color vibration across adjacent strokes, and dappled light",
    score: (m) =>
      ramp(m.microTexture, 8.8, 12.2) * 5.5 +
      ramp(m.avgChroma, 0.14, 0.24) * 2.5 +
      ramp(0.1 - m.flatRatio, 0, 0.09) * 2.5 +
      ramp(m.hueSpread, 3, 7) * 1.5,
  },
  {
    name: "Shallow-Focus Editorial Photography",
    medium: "Natural-light medium-format photography with smooth optical depth falloff",
    technique: "crisp central subject focus melting into softly blurred background bokeh and continuous filmic tone",
    score: (m) =>
      ramp(m.centerVsBorderSharpness, 1.38, 2.2) * 5 +
      ramp(0.25 - m.flatRatio, 0, 0.2) * 2 +
      ramp(m.contrastSpan, 110, 190) * 1.5,
  },
  {
    name: "Warm Analog Film & Atelier Realism",
    medium: "Warm 35mm analog color film or earth-pigment atelier painting with subtle organic grain",
    technique: "naturalistic continuous tonal modeling, warm amber midtones, and gentle shadow roll-off",
    score: (m) =>
      ramp(m.avgWarmth, 14, 42) * 3 +
      ramp(0.28 - m.flatRatio, 0, 0.2) * 2.5 +
      ramp(0.36 - m.sharpEdgeRatio, 0, 0.2) * 2 +
      ramp(9.0 - m.microTexture, 0, 4.5) * 1.5 -
      ramp(m.flatRatio, 0.3, 0.52) * 4 -
      ramp(m.brightRatio, 0.28, 0.5) * 3,
  },
  {
    name: "Cool Atmospheric & Minimalist Studio",
    medium: "Restrained cool-toned photography or contemporary matte studio rendering",
    technique: "clean balanced composition, cool slate-blue tonal transitions, and crisp material clarity",
    score: (m) =>
      ramp(-m.avgWarmth, 6, 32) * 5 +
      ramp(0.22 - m.avgChroma, 0, 0.16) * 2 +
      ramp(m.flatRatio, 0.14, 0.45) * 1.5,
  },
];

export function analyzeRgbaLocally(
  data: Uint8ClampedArray,
  sampleW: number,
  sampleH: number,
  naturalW: number,
  naturalH: number
): LocalAnalysisResult {
  const metrics = measureImageMetrics(
    data,
    sampleW,
    sampleH,
    naturalW,
    naturalH
  );

  let bestArchetype = ARCHETYPES[0];
  let bestScore = -Infinity;
  for (const arch of ARCHETYPES) {
    const s = arch.score(metrics);
    if (s > bestScore) {
      bestScore = s;
      bestArchetype = arch;
    }
  }

  const detectedEffects = detectVisualEffects(metrics);

  const palette = metrics.topColors.map((c) => ({
    name: closestPigmentName(c),
    hex: rgbToHex(c),
  }));

  const uniquePigments = [...new Set(palette.map((p) => p.name))];
  const hexSummary = palette.map((p) => p.hex).join(", ");

  let lightingPhrase: string;
  if (metrics.centerVsBorderLum > 22 && metrics.darkRatio > 0.25) {
    lightingPhrase =
      "spotlight-centered illumination falling off into deep vignetted edges";
  } else if (metrics.topVsBottomLum > 28) {
    lightingPhrase =
      "bright overhead sky or upper-key light casting grounded lower-plane shadows";
  } else if (metrics.darkRatio > 0.42 && metrics.contrastSpan > 165) {
    lightingPhrase =
      "dramatic low-key lighting carving luminous forms out of deep shadow";
  } else if (metrics.avgLum > 168 && metrics.darkRatio < 0.08) {
    lightingPhrase =
      "luminous high-key diffused daylight with airy, bright tonal clarity";
  } else if (metrics.flatRatio > 0.42) {
    lightingPhrase =
      "even flat graphic illumination with minimal soft gradients";
  } else {
    lightingPhrase =
      "natural directional illumination with smooth midtone gradations";
  }

  const aspectPhrase =
    metrics.width > metrics.height * 1.18
      ? "wide horizontal composition"
      : metrics.height > metrics.width * 1.18
        ? "vertical portrait-oriented composition"
        : "balanced square framing";

  const focusPhrase =
    metrics.centerVsBorderSharpness > 1.45
      ? "strong central focal sharpness fading into softly blurred outer edges"
      : metrics.microTexture >= 9.0
        ? "rich tactile brushwork texture across the entire frame"
        : metrics.sharpEdgeRatio > 0.35
          ? "crisp graphic contour definition across the entire frame"
          : "even edge-to-edge surface detail across the entire frame";

  let colorHarmony: string;
  if (metrics.avgChroma < 0.05) {
    colorHarmony = "achromatic monochrome palette";
  } else if (metrics.hueSpread <= 2) {
    colorHarmony = "restrained duotone and monochromatic harmony";
  } else if (metrics.hueSpread <= 5) {
    colorHarmony =
      metrics.avgWarmth > 15
        ? "harmonious warm analogous palette"
        : metrics.avgWarmth < -10
          ? "cool analogous slate-and-blue palette"
          : "curated limited-color harmony";
  } else {
    colorHarmony =
      metrics.vividRatio > 0.08
        ? "vibrant high-chroma multi-hue palette"
        : "rich balanced polychrome palette";
  }

  // Environment & Background analysis
  let envSetting: string;
  if (metrics.topCoolness > 12 && metrics.topAvgLum > 110 && metrics.botGreenBias > 4) {
    envSetting = "an outdoor natural landscape beneath an open blue sky with foliage or grassy terrain below";
  } else if (metrics.topCoolness > 14 && metrics.topAvgLum > 125) {
    envSetting = "an open outdoor sky backdrop with cool atmospheric light across the upper horizon";
  } else if (metrics.topAvgLum - metrics.botAvgLum > 35 && metrics.avgWarmth > 16) {
    envSetting = "a warm sunlit golden-hour horizon fading into darker foreground ground";
  } else if (metrics.perimAvgLum < 55 && (metrics.neonRatio > 0.02 || metrics.vividRatio > 0.08)) {
    envSetting = "a dark nocturnal or neon-lit night environment pierced by vivid color highlights";
  } else if (metrics.perimAvgLum < 48 && metrics.darkRatio > 0.42) {
    envSetting = "a deep low-key shadow void enveloping an indoor studio or dramatic dark background";
  } else if (metrics.perimFlatRatio > 0.52 && metrics.centerVsPerimColorDist > 34) {
    envSetting = "a clean minimalist studio or solid paper backdrop isolating the foreground subject";
  } else if (metrics.perimAvgLum > 180 && metrics.darkRatio < 0.1) {
    envSetting = "a bright high-key daylight setting or clean luminous paper ground";
  } else if (metrics.perimSharpRatio > 0.24) {
    envSetting = "a richly detailed edge-to-edge architectural, patterned, or natural environment";
  } else {
    envSetting = "a continuous midtone indoor or natural atmospheric setting";
  }

  const bgDepth =
    metrics.perimFlatRatio > 0.65
      ? "with unobstructed clean negative space around the perimeter"
      : metrics.centerVsBorderSharpness > 1.42 && metrics.perimSharpRatio < 0.18
        ? "with softly blurred shallow-depth bokeh background falloff"
        : "with balanced environmental depth across the frame";

  const environmentAndBackground = `${envSetting.charAt(0).toUpperCase() + envSetting.slice(1)}, ${bgDepth}`;

  // Typography / Font detection across upper, middle, or lower bands
  let typographyAndFonts = "";
  if (metrics.typographyZone !== "none" && metrics.typographyBandScore > 0.48) {
    const loc =
      metrics.typographyZone === "upper"
        ? "upper header area"
        : metrics.typographyZone === "lower"
          ? "lower caption margin"
          : "central focal band";
    if (detectedEffects.includes("RGB chromatic glitch split")) {
      typographyAndFonts = `Bold graphic display lettering in the ${loc} with chromatic RGB glitch offset`;
    } else if (detectedEffects.includes("halftone Ben-Day dots") || bestArchetype.name.includes("Pop Art")) {
      typographyAndFonts = `Punchy high-contrast comic sans-serif display typography in the ${loc}`;
    } else if (metrics.flatRatio > 0.25) {
      typographyAndFonts = `Clean high-contrast poster display typography set across the ${loc}`;
    } else {
      typographyAndFonts = `Bold editorial lettering integrated cleanly across the ${loc}`;
    }
  }

  // Character / Portrait figure styling detection (requires true portrait skin cluster OR strong non-typography vertical silhouette focus)
  let characterDesign = "";
  const isPortraitAspect = metrics.height > metrics.width * 1.12;
  const nonTextSilhouette =
    metrics.typographyZone !== "middle" &&
    metrics.silhouetteFocus > 2.25 &&
    metrics.centerVsPerimColorDist > 42 &&
    isPortraitAspect;
  if (metrics.hasLocalizedPortraitSkin || nonTextSilhouette) {
    if (bestArchetype.name.includes("Pixar")) {
      characterDesign =
        "Expressive 3D animated character with rounded Pixar-style facial proportions, soft subsurface skin shading, sculpted volumetric hair, and soft rim lighting";
    } else if (bestArchetype.name.includes("Clay")) {
      characterDesign =
        "Handmade sculpted clay character figurine with tactile matte rounded features, soft plasticine contours, and charming stop-motion silhouette";
    } else if (bestArchetype.name.includes("3D Digital")) {
      characterDesign =
        "Clean 3D CGI character silhouette with smooth volumetric shading, soft specular highlights, and sculpted garment planes";
    } else if (bestArchetype.name.includes("Cel-Shaded")) {
      characterDesign =
        "Central stylized character figure with crisp dark contour outlines, clean cel-shaded hair and garment planes, and rim highlights";
    } else if (bestArchetype.name.includes("Pop Art")) {
      characterDesign =
        "Bold graphic character portrait with heavy comic outlines, simplified tonal planes, and high-contrast pop-art silhouette";
    } else if (bestArchetype.name.includes("Woodblock") || bestArchetype.name.includes("Ink")) {
      characterDesign =
        "Stylized illustrated figure silhouette defined by rhythmic contour ink lines and flat tonal costume and hair shapes";
    } else if (bestArchetype.name.includes("Collage")) {
      characterDesign =
        "Layered cutout character silhouette built from bold overlapping planar shapes and contrasting paper textures";
    } else if (bestArchetype.name.includes("Baroque") || bestArchetype.name.includes("Photography") || bestArchetype.name.includes("Realism")) {
      characterDesign =
        "Central portrait-framed human figure with realistic proportions, naturalistic facial and garment lighting, and clean subject separation";
    } else {
      characterDesign =
        "Central portrait or standing figure silhouette with clear head-and-shoulders framing and expressive contour definition";
    }
  }

  const effectsClause =
    detectedEffects.length > 0
      ? ` Built with visible ${detectedEffects.join(", ")} effects.`
      : "";
  const typographyClause = typographyAndFonts
    ? ` Includes ${typographyAndFonts.toLowerCase()}.`
    : "";
  const characterClause = characterDesign
    ? ` Depicts a ${characterDesign.toLowerCase()}.`
    : "";

  const pigmentPhrase =
    uniquePigments.length > 0
      ? `anchored by ${uniquePigments.join(", ")} (${hexSummary})`
      : "";

  const styleOnlyPrompt = `${bestArchetype.name} style, executed in ${bestArchetype.medium.toLowerCase()}, featuring ${bestArchetype.technique}.${effectsClause}${typographyClause}${characterClause} Background treatment ${bgDepth}. Lit by ${lightingPhrase}, with ${focusPhrase}, in a ${colorHarmony} ${pigmentPhrase}.`;

  const fullPrompt = `${aspectPhrase.charAt(0).toUpperCase() + aspectPhrase.slice(1)} rendered in ${bestArchetype.name} style, executed in ${bestArchetype.medium.toLowerCase()}, featuring ${bestArchetype.technique}.${characterClause} Set in ${envSetting}, ${bgDepth}.${effectsClause}${typographyClause} Lit by ${lightingPhrase}, with ${focusPhrase}, in a ${colorHarmony} ${pigmentPhrase}.`;

  return {
    title: bestArchetype.name,
    detectedMovement: bestArchetype.name,
    mediumAndSurface: bestArchetype.medium,
    detectedEffects,
    typographyAndFonts: typographyAndFonts || undefined,
    characterDesign: characterDesign || undefined,
    environmentAndBackground,
    fullPrompt,
    styleOnlyPrompt,
    palette,
  };
}

export async function analyzeImageLocally(
  imageSrc: string
): Promise<LocalAnalysisResult> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = "anonymous";
    el.onload = () => resolve(el);
    el.onerror = () =>
      reject(new Error("Could not load image pixels for on-device analysis."));
    el.src = imageSrc;
  });

  const sampleW = Math.min(560, Math.max(240, img.naturalWidth));
  const sampleH = Math.max(
    180,
    Math.round((img.naturalHeight / Math.max(1, img.naturalWidth)) * sampleW)
  );

  const canvas = document.createElement("canvas");
  canvas.width = sampleW;
  canvas.height = sampleH;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Unable to initialize canvas for local visual scan.");
  }

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, sampleW, sampleH);
  const { data } = ctx.getImageData(0, 0, sampleW, sampleH);

  return analyzeRgbaLocally(
    data,
    sampleW,
    sampleH,
    img.naturalWidth,
    img.naturalHeight
  );
}
