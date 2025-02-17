# **Adding a New Vertical to the Freshmart Evolution Demo**

This guide explains how to integrate a new business vertical, including updates to the frontend, dataset, database setup, and visualization components.

---

## **1. Update the Frontend with Internationalization**

The frontend supports internationalization to dynamically adjust UI text based on the selected vertical.
To add a new vertical, create a new locale file:

```sh
frontend/src/locales/vertical.json
```

This file defines how the UI elements, data labels, and descriptions should be displayed
The new vertical should follow the structure used by **Freshmart** and **FreshFund**, replacing industry-specific terms where needed.


## **2. Update Graph Components**

The following components need to be updated to reflect the new vertical's data model and relationships:

- [DataProductGraph](frontend/src/components/DataProductGraph.jsx) – Displays the connections between key data entities. Update it to reflect how data flows within the new business domain.
- [ComposableDataProductsGraph](frontend/src/components/ComposableDataProductGraph.jsx) – Shows how different datasets combine into a meaningful view. Modify this to match how data is aggregated in the new vertical.
- [HierarchicalDataProductGraph](frontend/src/components/HierarchicalDataProductGraph.jsx) – Represents hierarchical relationships within the dataset. Ensure it correctly maps parent-child relationships specific to the new vertical.

---

## **3. Add New Fake Data**

1. Create a new directory:
   ```sh
   mkdir -p vertical/<new_vertical>/reduced
   ```
2. Copy the dataset from **Freshmart**:
   ```sh
   cp -r freshmart/*.csv <new_vertical>/
   cp -r freshmart/reduced/*.csv <new_vertical>/reduced/
   ```
3. Update product and category names to match the new vertical's theme.

The dataset should reflect the structure of the new vertical, ensuring that product names, categories, and pricing align with the new business use case.

---

## **3. Update Database Setup**

Modify [setup_database.sh](setup_database.sh) to ensure the correct dataset is loaded when the vertical is selected.

---

## **54 Run the New Vertical**

Start the demo with the new dataset:
```sh
DEMO=<new_vertical> docker compose up
```

Verify that:
- The **frontend labels and descriptions** match the new vertical.
- The **database loads the correct dataset**.
- The **graphs accurately represent** the new data model.

