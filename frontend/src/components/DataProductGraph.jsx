import React from "react";
import { useTranslation } from "react-i18next";

const DataProductGraph = () => {
    const { i18n } = useTranslation();

    const graphs = {
        freshmart: `
   Categories ──┐
                └──► Popularity Score ──┐
                                        │
      Sales ────┬──► Recent Prices ─────┤
                │                       │
                └──► High Demand ───────┤
                                        │
   Products ────┬──► Base Price ────────┼──► Inventory Item
                │                       │
   Inventory ───┴──► Stock Level ───────┤
                                        │
  Promotions ───────► Discount ─────────┘
  `,
        freshfund: `
   Sectors ──┐
             └──► Market Sentiment ──┐
                                     │
 Trading Volume ────┬──► Recent Prices ──────┐
                    │                        │
                    └──► High Demand ────────┤
                                             │
   Securities ────┬──► Base Price ───────────┼──► Security Price
                  │                          │
   Holdings ──────┴──► Available Supply ─────┤
                                             │
   Market Events ────► Volatility Adjustment ┘
  `,
    };

    const currentGraph = graphs[i18n.language] || graphs.freshmart;

    return <pre style={{ fontFamily: "monospace", whiteSpace: "pre" }}>{currentGraph}</pre>;
};

export default DataProductGraph;
