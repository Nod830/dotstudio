// 픽셀 단위 도형 그리기 알고리즘
const Raster = {
  // 브레젠험 직선
  line(x0, y0, x1, y1, plot) {
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      plot(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  },

  rect(x0, y0, x1, y1, plot) {
    [x0, x1] = [Math.min(x0, x1), Math.max(x0, x1)];
    [y0, y1] = [Math.min(y0, y1), Math.max(y0, y1)];
    for (let x = x0; x <= x1; x++) { plot(x, y0); plot(x, y1); }
    for (let y = y0 + 1; y < y1; y++) { plot(x0, y); plot(x1, y); }
  },

  rectFill(x0, y0, x1, y1, plot) {
    [x0, x1] = [Math.min(x0, x1), Math.max(x0, x1)];
    [y0, y1] = [Math.min(y0, y1), Math.max(y0, y1)];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) plot(x, y);
  },

  // 사각 영역에 내접하는 타원 (Alois Zingl 알고리즘)
  ellipse(x0, y0, x1, y1, plot) {
    let a = Math.abs(x1 - x0), b = Math.abs(y1 - y0), b1 = b & 1;
    let dx = 4 * (1 - a) * b * b, dy = 4 * (b1 + 1) * a * a;
    let err = dx + dy + b1 * a * a, e2;
    if (x0 > x1) { x0 = x1; x1 += a; }
    if (y0 > y1) y0 = y1;
    y0 += (b + 1) >> 1;
    y1 = y0 - b1;
    a *= 8 * a;
    b1 = 8 * b * b;
    do {
      plot(x1, y0); plot(x0, y0); plot(x0, y1); plot(x1, y1);
      e2 = 2 * err;
      if (e2 <= dy) { y0++; y1--; err += dy += a; }
      if (e2 >= dx || 2 * err > dy) { x0++; x1--; err += dx += b1; }
    } while (x0 <= x1);
    while (y0 - y1 <= b) {
      plot(x0 - 1, y0); plot(x1 + 1, y0++);
      plot(x0 - 1, y1); plot(x1 + 1, y1--);
    }
  },

  ellipseFill(x0, y0, x1, y1, plot) {
    const rows = new Map();
    Raster.ellipse(x0, y0, x1, y1, (x, y) => {
      const r = rows.get(y);
      if (!r) rows.set(y, [x, x]);
      else { if (x < r[0]) r[0] = x; if (x > r[1]) r[1] = x; }
    });
    for (const [y, [a, b]] of rows) for (let x = a; x <= b; x++) plot(x, y);
  },

  // 같은 색 영역을 찾는다. contiguous=false면 그림 전체에서 같은 색. clip(선택 영역) 밖은 건너뛴다.
  // 찾은 칸 번호 목록을 돌려준다.
  colorRegion(img, x, y, contiguous, clip) {
    if (!img.inBounds(x, y)) return [];
    const w = img.w, h = img.h;
    const px = new Uint32Array(img.data.buffer, img.data.byteOffset, w * h);
    const start = y * w + x;
    if (clip && !clip[start]) return [];
    const target = px[start];
    const out = [];
    if (!contiguous) {
      for (let i = 0; i < px.length; i++) if (px[i] === target && (!clip || clip[i])) out.push(i);
      return out;
    }
    const seen = new Uint8Array(w * h);
    const stack = [start];
    while (stack.length) {
      const i = stack.pop();
      if (seen[i] || px[i] !== target || (clip && !clip[i])) continue;
      seen[i] = 1;
      out.push(i);
      const cx = i % w, cy = (i / w) | 0;
      if (cx > 0) stack.push(i - 1);
      if (cx < w - 1) stack.push(i + 1);
      if (cy > 0) stack.push(i - w);
      if (cy < h - 1) stack.push(i + w);
    }
    return out;
  },

  // 채우기. contiguous=false면 같은 색을 그림 전체에서 바꾼다.
  floodFill(img, x, y, color, contiguous, clip) {
    const region = Raster.colorRegion(img, x, y, contiguous, clip);
    if (!region.length) return false;
    const px = new Uint32Array(img.data.buffer, img.data.byteOffset, img.w * img.h);
    const fill = new Uint32Array(new Uint8ClampedArray(color).buffer)[0];
    if (px[region[0]] === fill) return false;
    for (const i of region) px[i] = fill;
    return true;
  },
};
