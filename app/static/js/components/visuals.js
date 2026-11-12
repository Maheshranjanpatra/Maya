function canvasContext(canvas) {
  const bounds = canvas.getBoundingClientRect();
  const width = Math.max(220, bounds.width || 320);
  const height = Math.max(120, bounds.height || 150);
  const ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const context = canvas.getContext('2d');
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);
  return {
    context,
    width,
    height,
    text: getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#20231f',
    muted: getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() || '#686e64',
    border: getComputedStyle(document.documentElement).getPropertyValue('--surface-3').trim() || '#e8e7df',
    primary: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#44634d'
  };
}

function roundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, Math.max(0, width), height, radius);
  context.fill();
}

export const Visuals = {
  ring(canvas, percentage = 0, color, label) {
    const { context: ctx, width, height, text, border, primary } = canvasContext(canvas);
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.max(10, Math.min(width, height) / 2 - 15);
    const progress = Math.max(0, Math.min(100, Number(percentage))) / 100;
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.strokeStyle = border;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = color || primary;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    ctx.stroke();
    ctx.fillStyle = text;
    ctx.textAlign = 'center';
    ctx.font = '700 19px system-ui, sans-serif';
    ctx.fillText(`${Math.round(progress * 100)}%`, centerX, centerY + 5);
    if (label) {
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText(label, centerX, centerY + radius + 16);
    }
  },

  gauge(canvas, percentage, color, label) {
    const { context: ctx, width, height, text, border, primary } = canvasContext(canvas);
    const centerX = width / 2;
    const centerY = height * .78;
    const radius = Math.min(width * .36, height * .68);
    const progress = Math.max(0, Math.min(100, Number(percentage))) / 100;
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.strokeStyle = border;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, Math.PI, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = color || primary;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, Math.PI, Math.PI + Math.PI * progress);
    ctx.stroke();
    ctx.fillStyle = text;
    ctx.font = '700 20px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(progress * 100)}%`, centerX, centerY - 5);
    if (label) {
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText(label, centerX, height - 4);
    }
  },

  heatmap(canvas, days = []) {
    const { context: ctx, width, height, border, primary } = canvasContext(canvas);
    const columns = 12;
    const rows = 7;
    const gap = 4;
    const cell = Math.min(14, (width - 20 - gap * (columns - 1)) / columns);
    const left = (width - columns * cell - gap * (columns - 1)) / 2;
    const top = Math.max(6, (height - rows * cell - gap * (rows - 1)) / 2);
    const maxXp = Math.max(1, ...days.map(day => Math.max(0, Number(day.xp || 0))));
    for (let index = 0; index < columns * rows; index += 1) {
      const day = days[index] || {};
      const x = left + Math.floor(index / rows) * (cell + gap);
      const y = top + (index % rows) * (cell + gap);
      const ratio = Math.max(0, Number(day.xp || 0)) / maxXp;
      ctx.globalAlpha = day.xp ? .22 + ratio * .78 : .4;
      ctx.fillStyle = day.xp ? primary : border;
      roundedRect(ctx, x, y, cell, cell, 3);
    }
    ctx.globalAlpha = 1;
  },

  bars(canvas, values = []) {
    const { context: ctx, width, height, text, muted, border, primary } = canvasContext(canvas);
    const rows = values.slice(0, 6);
    const labelWidth = Math.min(110, width * .36);
    const startX = labelWidth + 8;
    const barWidth = width - startX - 10;
    const rowHeight = Math.min(28, (height - 12) / Math.max(1, rows.length));
    const max = Math.max(1, ...rows.map(item => Math.max(Number(item.est || 0), Number(item.actual || 0), Number(item.value || 0))));
    rows.forEach((item, index) => {
      const y = 8 + index * rowHeight;
      ctx.fillStyle = muted;
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(String(item.label || '').slice(0, 16), 2, y + 13, labelWidth - 4);
      const value = Number(item.value ?? item.est ?? 0);
      ctx.fillStyle = border;
      roundedRect(ctx, startX, y + 3, barWidth, 10, 4);
      ctx.fillStyle = item.color || primary;
      roundedRect(ctx, startX, y + 3, barWidth * Math.min(1, value / max), 10, 4);
      if (item.actual !== undefined) {
        ctx.fillStyle = '#d09338';
        roundedRect(ctx, startX, y + 16, barWidth * Math.min(1, Number(item.actual) / max), 5, 3);
      } else {
        ctx.fillStyle = text;
        ctx.textAlign = 'right';
        ctx.fillText(`${Math.round(value)}%`, width - 2, y + 13);
      }
    });
  },

  spark(canvas, values = []) {
    const { context: ctx, width, height, primary, border } = canvasContext(canvas);
    const valuesToDraw = values.map(value => Math.max(0, Number(value || 0)));
    if (!valuesToDraw.length) return;
    const max = Math.max(1, ...valuesToDraw);
    const padding = 12;
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding, height - padding);
    ctx.lineTo(width - padding, height - padding);
    ctx.stroke();
    ctx.strokeStyle = primary;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    valuesToDraw.forEach((value, index) => {
      const x = padding + (width - padding * 2) * index / Math.max(1, valuesToDraw.length - 1);
      const y = height - padding - (height - padding * 2) * value / max;
      if (index) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.stroke();
  },

  timeline(canvas, exams = []) {
    const { context: ctx, width, height, primary, muted, border } = canvasContext(canvas);
    const today = new Date();
    const upcoming = exams.slice(0, 6);
    if (!upcoming.length) {
      ctx.fillStyle = muted;
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillText('Add an exam to see the countdown timeline.', 8, 24);
      return;
    }
    const span = Math.max(1, ...upcoming.map(exam => Math.max(0, Number(exam.days_remaining))));
    const x0 = 12;
    const x1 = width - 12;
    const lineY = 24;
    ctx.strokeStyle = border;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x0, lineY);
    ctx.lineTo(x1, lineY);
    ctx.stroke();
    upcoming.forEach((exam, index) => {
      const position = Math.max(.03, 1 - Math.max(0, exam.days_remaining) / span);
      const x = x0 + (x1 - x0) * position;
      ctx.fillStyle = exam.risk === 'crunch' ? '#b54b43' : exam.risk === 'tight' ? '#c07816' : primary;
      ctx.beginPath();
      ctx.arc(x, lineY, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = muted;
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = index % 2 ? 'right' : 'left';
      ctx.fillText(`${exam.subject_name} · ${exam.days_remaining}d`, x + (index % 2 ? -7 : 7), 48 + (index % 2) * 20, width / 2 - 8);
    });
  },

  monthGrid(canvas, days = []) {
    this.heatmap(canvas, days);
  }
};
