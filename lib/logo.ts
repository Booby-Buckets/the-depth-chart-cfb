// Team logos come from ESPN as 500x500 PNGs (20-43 KB each) but are drawn at 20-84 px. ESPN's
// resizer serves the same image at any size, so ask for about twice the display size (sharp on
// retina), snapped to a few sizes so the CDN cache is shared across pages. Anything that isn't
// an ESPN team logo passes through untouched. Same rule as the legacy pages' CFB.logo().
const LOGO_SIZES = [48, 96, 128, 192];

export function logo(url: string | null | undefined, px = 22): string {
  if (!url) return "";
  const m = String(url).match(/^https?:\/\/a\.espncdn\.com(\/i\/teamlogos\/[^?#]+)/);
  if (!m) return url;
  const want = Math.round(px * 2);
  const size = LOGO_SIZES.find((s) => s >= want) ?? LOGO_SIZES[LOGO_SIZES.length - 1];
  return `https://a.espncdn.com/combiner/i?img=${m[1]}&w=${size}&h=${size}`;
}
