import React from "react";
import { useTranslation } from "react-i18next";

const HierarchicalDataProductGraph = () => {
    const { i18n } = useTranslation();

    const graphs = {
        freshmart: `
Shopping Cart ─────┐
                   ├──► Category Totals ───┐
Categories ────────┤                       ├──► Hierarchical Summary
                   │                       │    
Parent Categories ─┴───► Category Tree ────┘    

                                              
`,
        freshfund: `
 Portfolio ─────┐
                ├──► Sector Totals ───┐
Sectors ────────┤                     ├──► Portfolio Allocation
                │                     │    
 Asset Classes ─┴───► Sector Tree ────┘    

                                              
`,
    };

    const currentGraph = graphs[i18n.language] || graphs.freshmart;

    return <pre style={{ fontFamily: "monospace", whiteSpace: "pre" }}>{currentGraph}</pre>;
};

export default HierarchicalDataProductGraph;
