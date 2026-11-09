// A picture of a chart that still makes sense once it has been copied into a message or a post. A bare screenshot of a river level
// carries no date, no source and no warning that it is unofficial, so the picture gets a title and period above the chart and, below
// it, the lines that say which data it shows, when it was saved and where the official warnings are (the wording comes from data.js).
// Browser only: it draws on a canvas.

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The picture could not be made: the chart image did not load.'));
    img.src = src;
  });
}

// Break `text` into lines that fit `maxWidth` in the context's current font. A single word wider than that stays on one line.
export function wrapText(ctx, text, maxWidth) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

// Resolves to a PNG Blob. `echart` is a live ECharts instance, `T` the theme tokens (tokens() in ui.js), `footer` an array of strings.
export async function chartPicture(echart, { T, title, subtitle, footer, scale = 2 }) {
  // The zoom slider is a control: in a still picture it would look like one that does nothing. It is left out and the strip it
  // occupied at the bottom is cropped (its height and offset are in the chart's own options, so the crop follows them).
  const slider = echart.getOption().dataZoom?.find(z => z.type === 'slider');
  const crop = slider ? Math.round(((Number(slider.height) || 0) + (Number(slider.bottom) || 0) + 6) * scale) : 0;
  const chartImg = await loadImage(echart.getDataURL({ type: 'png', pixelRatio: scale, backgroundColor: T.surface, excludeComponents: ['toolbox', 'dataZoom'] }));
  const width = chartImg.width, chartH = chartImg.height - crop, pad = 16 * scale, textWidth = width - 2 * pad;
  const font = (px, weight = 400) => `${weight} ${px * scale}px ${T.font}`;
  const blocks = [
    { where: 'head', text: title, px: 17, weight: 700, color: T.text },
    { where: 'head', text: subtitle, px: 13, color: T.muted },
    ...footer.map((text, i) => ({ where: 'foot', text, px: 12, color: i === 0 ? T.text : T.muted })),
  ];
  // Measure first (the canvas has to be sized before anything is drawn on it).
  const measuring = document.createElement('canvas').getContext('2d');
  for (const b of blocks) {
    measuring.font = font(b.px, b.weight);
    b.lines = wrapText(measuring, b.text, textWidth);
    b.lineHeight = Math.round(b.px * 1.4 * scale);
  }
  const heightOf = where => blocks.filter(b => b.where === where).reduce((sum, b) => sum + b.lines.length * b.lineHeight + 3 * scale, 0) + pad;
  const headH = heightOf('head'), footH = heightOf('foot');

  const canvas = Object.assign(document.createElement('canvas'), { width, height: headH + chartH + footH });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = T.surface;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(chartImg, 0, 0, width, chartH, 0, headH, width, chartH);
  ctx.fillStyle = T.line;
  ctx.fillRect(pad, headH + chartH, textWidth, scale);
  ctx.textBaseline = 'top';
  const y = { head: pad, foot: headH + chartH + pad / 2 };
  for (const b of blocks) {
    ctx.font = font(b.px, b.weight);
    ctx.fillStyle = b.color;
    for (const line of b.lines) { ctx.fillText(line, pad, y[b.where]); y[b.where] += b.lineHeight; }
    y[b.where] += 3 * scale;
  }
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The picture could not be made: this browser would not save it.');
  return blob;
}
