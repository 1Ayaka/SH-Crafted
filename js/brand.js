export const BRAND_LOGO_URL = '/brand/logo.png';
export const DEFAULT_BRAND_LOGO_URL = '/assets/brand/tanwuzhi-logo.png';

export function handleBrandLogoError(event) {
  const image = event?.currentTarget;
  if (!image || image.dataset.brandFallbackApplied === 'true') return;
  image.dataset.brandFallbackApplied = 'true';
  image.src = DEFAULT_BRAND_LOGO_URL;
}

export function brandLogoUrl(version = '') {
  return version ? `${BRAND_LOGO_URL}?v=${encodeURIComponent(version)}` : BRAND_LOGO_URL;
}

export function applyBrandLogoVersion(version = Date.now().toString(36)) {
  const url = brandLogoUrl(version);
  document.querySelectorAll('img[data-brand-logo]').forEach((image) => {
    delete image.dataset.brandFallbackApplied;
    image.src = url;
  });
  document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]').forEach((link) => { link.href = url; });
  return url;
}
