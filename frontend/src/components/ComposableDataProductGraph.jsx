import React from "react";
import { useTranslation } from "react-i18next";

const ComposableDataProductGraph = () => {
    const { i18n } = useTranslation();

    const graphs = {
        freshmart: `
Inventory Item ───────────────────┐
                                  |
   Products ──────────────────────┤     
                                  ├──► Shopping Cart     
   Categories ────────────────────┤     
                                  │     
   Inventory ─────────────────────┘
`,
        freshfund: `
            Security ───────────────────┐
                                        |
       Securities ──────────────────────┤     
                                        ├──► Portfolio 
      Asset Classes ────────────────────┤     
                                        │     
Available Holdings ─────────────────────┘
`,
    };

    const currentGraph = graphs[i18n.language] || graphs.freshmart;

    return <pre style={{ fontFamily: "monospace", whiteSpace: "pre" }}>{currentGraph}</pre>;
};

export default ComposableDataProductGraph;
