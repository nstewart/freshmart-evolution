import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import freshmart from "./locales/freshmart.json";
//import freshfund from "./locales/freshfund.json";

const defaultLanguage = import.meta.env.VITE_APP_LANG || "freshmart";

i18n
    .use(initReactI18next)
    .init({
        resources: {
            freshmart: { translation: freshmart } //,
            //freshfund: { translation: freshfund }
        },
        lng: defaultLanguage,
        fallbackLng: "freshmart",
        interpolation: { escapeValue: false }
    });

export default i18n;
