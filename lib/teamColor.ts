// Team colours, computed on the server so no script has to paint them.
//   band  a version of the team colour that white text reads on (contrast >= 4.5)
//   light / dark  the team colour nudged until it reads as text/marks on each theme's background
type RGB = [number, number, number];
const hex2rgb = (h: string | null): RGB => {
  const x = (h || "555555").replace("#", "");
  return [0, 2, 4].map((i) => parseInt(x.substr(i, 2), 16)) as RGB;
};
const lum = (c: RGB) => {
  const v = c.map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
};
const contrast = (a: RGB, b: RGB) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const mix = (a: RGB, b: RGB, t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t)) as RGB;
const css = (c: RGB) => `rgb(${c.join(",")})`;
function toward(c: RGB, target: RGB, bg: RGB, need: number) {
  for (let t = 0; t <= 1.0001; t += 0.05) { const m = mix(c, target, t); if (contrast(m, bg) >= need) return m; }
  return target;
}
const LIGHT_BG: RGB = [250, 249, 246], DARK_BG: RGB = [10, 14, 24];

export function teamColors(hex: string | null) {
  const base = hex2rgb(hex);
  return {
    "--tc-band": css(toward(base, [0, 0, 0], [255, 255, 255], 4.5)),
    "--tc-light": css(toward(base, [0, 0, 0], LIGHT_BG, 3.2)),
    "--tc-dark": css(toward(base, [255, 255, 255], DARK_BG, 3.2)),
  } as React.CSSProperties;
}
