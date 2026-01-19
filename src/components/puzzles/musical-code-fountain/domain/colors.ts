export const midiToHsl = (midi: number) => {
  const hue = ((midi * 37) % 360 + 360) % 360;
  // Use comma-separated syntax for broad Canvas/WebGL compatibility.
  return `hsl(${hue}, 85%, 55%)`;
};

/**
 * Ensures a color string is in 6-digit hex format (#RRGGBB).
 * Converts:
 * - hsl(h, s%, l%) -> #RRGGBB
 * - rgb(r, g, b) -> #RRGGBB
 * - #XXX -> #XXXXXX
 * - fallback -> #000000
 */
export const ensureHex = (color: string | undefined | null): string => {
  if (!color) return '#000000';
  const c = color.trim().toLowerCase();

  // Already #RRGGBB
  if (/^#[0-9a-f]{6}$/.test(c)) return c;

  // #RGB -> #RRGGBB
  if (/^#[0-9a-f]{3}$/.test(c)) {
    return '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
  }

  // hsl(h, s%, l%)
  const hslCtx = c.match(/^hsl\(\s*([0-9.]+)\s*(?:,|\s)\s*([0-9.]+)%\s*(?:,|\s)\s*([0-9.]+)%\s*\)$/);
  if (hslCtx) {
    const h = parseFloat(hslCtx[1]);
    const s = parseFloat(hslCtx[2]) / 100;
    const l = parseFloat(hslCtx[3]) / 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  }

  // rgb(r, g, b)
  const rgbCtx = c.match(/^rgb\(\s*([0-9]+)\s*(?:,|\s)\s*([0-9]+)\s*(?:,|\s)\s*([0-9]+)\s*\)$/);
  if (rgbCtx) {
    const r = parseInt(rgbCtx[1], 10);
    const g = parseInt(rgbCtx[2], 10);
    const b = parseInt(rgbCtx[3], 10);
    const toHex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  return '#000000';
};
