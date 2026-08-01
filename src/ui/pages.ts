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
@media(max-width:1200px){#settings.page.active{display:grid;grid-template-columns:minmax(0,1fr);gap:16px;width:100%;max-width:100%;min-width:0}#settings.page.active>.page-head,#settings.page.active>.settings-card,#settings.page.active>.domain-profiles-card,#settings.page.active>.admin-path-card{grid-column:1/-1!important;width:100%;min-width:0}#settings.page.active>.settings-card{margin:0}#settings.page.active>.settings-card>.section-head{width:calc(100% - 54px)}}
@media(max-width:520px){#settings.page.active>.settings-card>.section-icon{margin-right:9px}#settings.page.active>.settings-card>.section-head{width:calc(100% - 51px);display:inline-flex;align-items:flex-start;flex-wrap:wrap}#settings.page.active>.settings-card>.section-head .status{width:100%;margin-top:7px}}
@media(max-width:640px){#settings.page.active{gap:12px}#settings.page.active>.page-head{margin-bottom:0}#settings.page.active>.settings-card{padding:16px;border-radius:15px;overflow:hidden}#settings.page.active>.settings-card>.section-icon{width:34px;height:34px;margin-right:8px;margin-bottom:0}#settings.page.active>.settings-card>.section-head{min-width:0;margin-bottom:14px}#settings.page.active>.settings-card>.section-head>div{min-width:0}#settings.page.active>.settings-card>.section-head h3{font-size:16px;overflow-wrap:anywhere}#settings.page.active>.settings-card>.section-head p{overflow-wrap:anywhere}#settings.page.active>.settings-card>.actions{grid-template-columns:1fr;min-width:0}#settings.page.active>.settings-card>.actions>*{width:100%;min-width:0}#settings.page.active .domain-profile-row{grid-template-columns:1fr!important;gap:8px}#settings.page.active .domain-profile-row>*{width:100%;min-width:0}#settings.page.active .domain-profile-row .remove-domain{justify-self:stretch}#settings.page.active input,#settings.page.active select,#settings.page.active textarea{max-width:100%;min-width:0}#settings.page.active .hint{overflow-wrap:anywhere}}
@media(max-width:400px){#settings.page.active{gap:10px}#settings.page.active>.page-head h2{font-size:22px}#settings.page.active>.page-head p{font-size:12px}#settings.page.active>.settings-card{padding:14px}#settings.page.active>.settings-card>.section-head{width:calc(100% - 48px)}#settings.page.active>.settings-card>.section-icon{width:32px;height:32px;margin-right:7px}}
@media(max-width:640px){#app button:not(.icon-button):not(.close):not(.toast-close){min-height:42px;border-radius:11px;padding:10px 14px;font-size:13px;font-weight:700;line-height:1.25}#app button:not(.icon-button):not(.close):not(.toast-close):hover{transform:none}#app .actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;min-width:0}#app .actions>button:not(.icon-button):not(.close):not(.toast-close){width:100%;min-width:0}#app .settings-card .actions,#app .dialog-actions{grid-template-columns:1fr}#app .top-actions button:not(.icon-button):not(.close):not(.toast-close){flex:0 0 40px;width:40px;height:40px;min-height:40px;padding:8px;border-radius:11px}#app .nav button:not(.icon-button):not(.close):not(.toast-close){width:auto;min-height:40px;padding:9px 12px;border-radius:10px}}
@media(max-width:520px){#settings.page.active>.settings-card>.section-icon{display:grid;margin:0 0 10px}#settings.page.active>.settings-card>.section-head{display:flex;width:100%;flex-direction:column;align-items:stretch;gap:3px;margin-bottom:14px}#settings.page.active>.settings-card>.section-head .status{width:100%;margin-top:4px}}
@media(max-width:400px){#app button:not(.icon-button):not(.close):not(.toast-close){min-height:40px;padding:9px 12px;font-size:12px}#app .actions{gap:7px}}
</style>`;

export function adminPage() {
  return renderAdminPage().replace("</head>", `${settingsLayoutStyles}</head>`);
}
