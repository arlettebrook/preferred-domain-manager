/** Public page entry points. Keep each page implementation in its own module. */
import { adminPage as renderAdminPage } from "./admin-page";

export { landingPage } from "./landing-page";

const settingsLayoutStyles = `<style>
#settings.page.active{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:start;gap:18px}
#settings.page:not(.active){display:none}
#settings.page.active>.page-head{grid-column:1/-1}
#settings.page.active>.settings-card{width:100%;max-width:none;margin:0}
@media(max-width:1050px){#settings.page.active{display:block}#settings.page.active>.settings-card{margin:0 0 16px}#settings.page.active>.settings-card:last-child{margin-bottom:0}}
</style>`;

export function adminPage() {
  return renderAdminPage().replace("</head>", `${settingsLayoutStyles}</head>`);
}
