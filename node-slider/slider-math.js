// Activation zones take precedence over the default left-hand interval rule.
export function nodeAtPosition(x, width, count, activationRadius = 12) {
  if (count < 2 || width <= 0) return 0;
  const position = Math.max(0, Math.min(width, x));
  const step = width / (count - 1);
  const nearest = Math.round(position / step);
  if (Math.abs(position - nearest * step) <= Math.min(activationRadius, step / 3)) return nearest;
  return Math.min(count - 1, Math.floor(position / step));
}
