/** Clean axis ticks from zero: 0, 500, 1,000, 1,500. Whole-number steps for counts. */
export function niceScale(maxValue, { ticks = 4, integer = true } = {}) {
  const max = Math.max(0, Number(maxValue) || 0);
  if (max === 0) return integer ? { max: 4, ticks: [0, 1, 2, 3, 4] } : { max: 1, ticks: [0, 0.25, 0.5, 0.75, 1] };

  const raw = max / ticks;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const steps = integer ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10];
  let step = steps.find(s => normalized <= s) * magnitude;
  if (integer) step = Math.max(1, Math.round(step));

  const top = Math.ceil(max / step) * step;
  const values = [];
  for (let v = 0; v <= top + step / 1e6; v += step) values.push(Math.round(v * 1e6) / 1e6);
  return { max: top, ticks: values };
}

/** Show every nth x label so labels never collide. */
export function labelStride(count, plotWidth, minSpacing = 72) {
  return Math.max(1, Math.ceil(count / Math.max(1, Math.floor(plotWidth / minSpacing))));
}

export const accessor = x => (typeof x === 'function' ? x : d => d[x]);
