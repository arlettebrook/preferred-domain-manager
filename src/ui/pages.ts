/** Public page entry points. Keep each page implementation in its own module. */
import { adminPage as renderAdminPage } from "./admin-page";

export { landingPage } from "./landing-page";

const settingsLayoutStyles = `<style>
#settings.page.active{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));align-items:start;gap:20px}
#settings.page:not(.active){display:none}
#settings.page.active>.page-head{grid-column:1/-1;margin:0 0 2px}
#settings.page.active>.settings-card{width:100%;max-width:none;min-width:0;margin:0}
#settings.page.active>.domain-profiles-card{grid-column:1/-1}
#settings.page.active>.admin-path-card{grid-column:span 5}
#settings.page.active>.settings-card:not(.domain-profiles-card):not(.admin-path-card){grid-column:span 7}
#settings.page.active>.settings-card>.section-icon{float:none;display:inline-grid;margin:0 12px 0 0;vertical-align:top}
#settings.page.active>.settings-card>.section-head{display:inline-flex;width:calc(100% - 54px);min-height:34px;margin-bottom:18px;padding-left:0;vertical-align:top}
@media(max-width:1050px){#settings.page.active{display:grid;grid-template-columns:1fr;gap:16px}#settings.page.active>.page-head,#settings.page.active>.settings-card,#settings.page.active>.domain-profiles-card,#settings.page.active>.admin-path-card{grid-column:1}#settings.page.active>.settings-card{margin:0}#settings.page.active>.settings-card>.section-head{width:calc(100% - 54px)}}
@media(max-width:520px){#settings.page.active>.settings-card>.section-icon{margin-right:9px}#settings.page.active>.settings-card>.section-head{width:calc(100% - 51px);display:inline-flex;align-items:flex-start;flex-wrap:wrap}#settings.page.active>.settings-card>.section-head .status{width:100%;margin-top:7px}}
</style>`;

export function adminPage() {
  return renderAdminPage().replace("</head>", `${settingsLayoutStyles}</head>`);
}
