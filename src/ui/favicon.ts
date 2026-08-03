/** Shared browser icon for the public site and admin console. */
export const faviconSvg = String.raw`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="优选域名管理">
  <defs>
    <linearGradient id="brand" x1="8" y1="6" x2="56" y2="58" gradientUnits="userSpaceOnUse">
      <stop stop-color="#6b82ff"/>
      <stop offset="1" stop-color="#956fff"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="16" fill="url(#brand)"/>
  <path d="M16 12h32a8 8 0 0 1 8 8v5c-12-5-29-6-48 1v-6a8 8 0 0 1 8-8Z" fill="#fff" opacity=".1"/>
  <text x="32" y="43" fill="#fff" font-family="system-ui,-apple-system,'Segoe UI',sans-serif" font-size="34" font-weight="800" text-anchor="middle">优</text>
</svg>`;
