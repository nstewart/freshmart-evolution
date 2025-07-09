CREATE SECRET IF NOT EXISTS pg_pass AS 'mysecret';

CREATE CONNECTION IF NOT EXISTS pg_conn TO POSTGRES (
    HOST 'postgres',
    PORT 5432,
    USER 'postgres',
    DATABASE 'postgres',
    PASSWORD SECRET pg_pass
);

CREATE SOURCE IF NOT EXISTS pg_src FROM POSTGRES CONNECTION pg_conn (
    PUBLICATION mz_source
) FOR ALL TABLES;

COMMENT ON SOURCE products IS 'Authoritative representation of all sellable products in the business. Captures core attributes, categorization, supplier linkage, and lifecycle state. Serves as the foundational reference point for pricing, inventory, and merchandising operations.';
COMMENT ON COLUMN products.product_id IS 'Globally unique identifier for the product. Primary reference key used across all transactional and analytical systems.';
COMMENT ON COLUMN products.product_name IS 'Customer-facing name of the product. Used for display, search, merchandising, and internal reference.';
COMMENT ON COLUMN products.base_price IS 'Base unit price of the product, set by the business prior to adjustments. Forms the anchor for dynamic pricing calculations.';
COMMENT ON COLUMN products.category_id IS 'Foreign key linking the product to its associated category, used for classification, navigation, and pricing segmentation.';
COMMENT ON COLUMN products.supplier_id IS 'Foreign key linking the product to its supplier. Enables sourcing traceability and supplier-specific reporting.';
COMMENT ON COLUMN products.available IS 'Boolean flag indicating whether the product is active and sellable. Controls product visibility across commerce experiences.';
COMMENT ON COLUMN products.last_update_time IS 'Timestamp of the most recent update to the products metadata. Supports auditability and freshness checks in downstream systems.';
COMMENT ON SOURCE categories IS 'Canonical list of product categories used for organizing catalog items into business-relevant hierarchies. Supports navigation, filtering, and analytics.';
COMMENT ON COLUMN categories.category_id IS 'Unique identifier for the product category. Primary reference used in catalog and pricing segmentation.';
COMMENT ON COLUMN categories.category_name IS 'Descriptive name of the category used in merchandising, filtering, and customer-facing interfaces.';
COMMENT ON COLUMN categories.parent_id IS 'Optional reference to a parent category. Enables hierarchical organization of the category tree.';
COMMENT ON SOURCE suppliers IS 'Master list of suppliers that provide products for sale. Supports vendor management, sourcing logic, and procurement analysis.';
COMMENT ON COLUMN suppliers.supplier_id IS 'Unique identifier for the supplier. Links products to their respective source vendors.';
COMMENT ON COLUMN suppliers.supplier_name IS 'Human-readable name of the supplier used in internal reports and dashboards.';
COMMENT ON SOURCE sales IS 'Fact table recording all historical product sales. Supports downstream pricing models, trend analysis, and demand forecasting.';
COMMENT ON COLUMN sales.sale_id IS 'Unique identifier for a completed sale transaction.';
COMMENT ON COLUMN sales.product_id IS 'Foreign key referencing the sold product. Links sale records to product metadata.';
COMMENT ON COLUMN sales.sale_price IS 'Actual unit price at which the product was sold. Used for revenue calculations and pricing analysis.';
COMMENT ON COLUMN sales.sale_date IS 'Timestamp of the sale transaction. Supports time-series analysis and demand seasonality.';
COMMENT ON COLUMN sales.price IS 'List price of the product at the time of sale. Used to compute discounting and margin performance.';
COMMENT ON SOURCE inventory IS 'Real-time record of product stock across warehouses. Supports availability checks, fulfillment logic, and restocking workflows.';
COMMENT ON COLUMN inventory.inventory_id IS 'Unique identifier for an inventory record.';
COMMENT ON COLUMN inventory.product_id IS 'Foreign key linking inventory to the associated product.';
COMMENT ON COLUMN inventory.stock IS 'Current available quantity of the product in stock. Drives availability logic for fulfillment and pricing.';
COMMENT ON COLUMN inventory.warehouse_id IS 'Identifier for the warehouse or location holding the stock. Supports distributed inventory management.';
COMMENT ON COLUMN inventory.restock_date IS 'Expected or actual date for inventory replenishment. Enables proactive inventory planning and display of availability signals.';
COMMENT ON SOURCE promotions IS 'Operational record of active and historical product-level promotions. Drives price discounting and marketing visibility.';
COMMENT ON COLUMN promotions.promotion_id IS 'Unique identifier for the promotion.';
COMMENT ON COLUMN promotions.product_id IS 'Foreign key linking the promotion to the relevant product.';
COMMENT ON COLUMN promotions.promotion_discount IS 'Discount amount applied to the product, expressed as a percentage. Drives temporary reductions in price.';
COMMENT ON COLUMN promotions.start_date IS 'Start date of the promotional period. Controls discount eligibility.';
COMMENT ON COLUMN promotions.end_date IS 'End date of the promotional period.';
COMMENT ON COLUMN promotions.active IS 'Boolean indicating whether the promotion is currently live and applicable.';
COMMENT ON COLUMN promotions.updated_at IS 'Timestamp of the most recent update to the promotions definition.';
COMMENT ON SOURCE shopping_cart IS 'Live representation of products added to users shopping carts. Drives real-time pricing, availability checks, and checkout readiness.';
COMMENT ON COLUMN shopping_cart.product_id IS 'Identifier of the product added to the shopping cart.';
COMMENT ON COLUMN shopping_cart.product_name IS 'Display name of the product in the cart for end-user visibility.';
COMMENT ON COLUMN shopping_cart.category_id IS 'Identifier for the products category at time of cart addition. Used for contextual grouping and segmentation.';
COMMENT ON COLUMN shopping_cart.price IS 'Quoted unit price at time of addition to cart. May be superseded by dynamic pricing during checkout.';
COMMENT ON COLUMN shopping_cart.ts IS 'Timestamp when the item was added to the cart. Supports cart lifecycle tracking and abandonment analysis.';

CREATE VIEW IF NOT EXISTS dynamic_pricing AS
WITH recent_prices AS (
    SELECT grp.product_id, AVG(price) AS avg_price
    FROM (SELECT DISTINCT product_id FROM sales) grp, 
    LATERAL (
        SELECT product_id, price 
        FROM sales
        WHERE sales.product_id = grp.product_id 
        ORDER BY sale_date DESC LIMIT 10
    ) sub
    GROUP BY grp.product_id
),

promotion_effect AS (
    SELECT 
        p.product_id,
        MIN(pr.promotion_discount) AS promotion_discount
    FROM promotions pr
    JOIN products p ON pr.product_id = p.product_id
    WHERE pr.active = TRUE
    GROUP BY p.product_id
),

popularity_score AS (
    SELECT 
        s.product_id,
        RANK() OVER (PARTITION BY p.category_id ORDER BY COUNT(s.sale_id) DESC) AS popularity_rank,
        COUNT(s.sale_id) AS sale_count
    FROM sales s
    JOIN products p ON s.product_id = p.product_id
    GROUP BY s.product_id, p.category_id
),

inventory_status AS (
    SELECT 
        i.product_id,
        SUM(i.stock) AS total_stock,
        RANK() OVER (ORDER BY SUM(i.stock) DESC) AS stock_rank
    FROM inventory i
    GROUP BY i.product_id
),

high_demand_products AS (
    SELECT 
        p.product_id,
        AVG(s.sale_price) AS avg_sale_price,
        COUNT(s.sale_id) AS total_sales
    FROM products p
    JOIN sales s ON p.product_id = s.product_id
    GROUP BY p.product_id
    HAVING COUNT(s.sale_id) > (SELECT AVG(total_sales) FROM (SELECT COUNT(*) AS total_sales FROM sales GROUP BY product_id) subquery)
),

dynamic_pricing AS (
    SELECT 
        p.product_id,
        p.base_price,
        CASE 
            WHEN pop.popularity_rank <= 3 THEN 1.2
            WHEN pop.popularity_rank BETWEEN 4 AND 10 THEN 1.1
            ELSE 0.9
        END AS popularity_adjustment,
        rp.avg_price,
        COALESCE(1.0 - (pe.promotion_discount / 100), 1) AS promotion_discount,
        CASE 
            WHEN inv.stock_rank <= 3 THEN 1.1
            WHEN inv.stock_rank BETWEEN 4 AND 10 THEN 1.05
            ELSE 1
        END AS stock_adjustment,
        CASE 
            WHEN p.base_price > rp.avg_price THEN 1 + (p.base_price - rp.avg_price) / rp.avg_price
            ELSE 1 - (rp.avg_price - p.base_price) / rp.avg_price
        END AS demand_multiplier,
        hd.avg_sale_price,
        CASE 
            WHEN p.product_name ilike '%cheap%' THEN 0.8
            ELSE 1.0
        END AS additional_discount
    FROM products p 
    LEFT JOIN recent_prices rp ON p.product_id = rp.product_id
    LEFT JOIN promotion_effect pe ON p.product_id = pe.product_id
    JOIN popularity_score pop ON p.product_id = pop.product_id
    LEFT JOIN inventory_status inv ON p.product_id = inv.product_id
    LEFT JOIN high_demand_products hd ON p.product_id = hd.product_id
)
SELECT 
    dp.product_id,
    dp.base_price * dp.popularity_adjustment * dp.promotion_discount * dp.stock_adjustment * dp.demand_multiplier * dp.additional_discount AS adjusted_price,
    p.last_update_time
FROM dynamic_pricing dp
JOIN products p ON dp.product_id = p.product_id;

COMMENT ON VIEW dynamic_pricing IS 'Dynamic pricing engine that calculates real-time, optimized pricing for products based on market conditions, demand patterns, inventory levels, and promotional strategies. Automatically adjusts pricing to maximize revenue while maintaining competitive positioning and reflects current market dynamics to support pricing decisioning across commerce operations.';
COMMENT ON COLUMN dynamic_pricing.product_id IS 'Foreign key reference to the products table. Links each dynamic pricing calculation to its specific product entity, enabling price lookups and pricing rule applications across commerce systems.';
COMMENT ON COLUMN dynamic_pricing.adjusted_price IS 'Algorithmically calculated optimized price that incorporates multiple business factors including popularity ranking, active promotions, inventory levels, historical demand patterns, and product characteristics. Represents the recommended selling price for operational use in commerce systems and pricing displays.';
COMMENT ON COLUMN dynamic_pricing.last_update_time IS 'Timestamp indicating when the underlying product data was last modified. Enables pricing systems to validate price freshness and implement price staleness controls to ensure pricing accuracy in customer-facing applications.';

CREATE VIEW dynamic_price_shopping_cart AS SELECT 
  sc.product_id,  
  sc.product_name,
  c.category_id,
  c.category_name,
  dp.adjusted_price AS price,
  COALESCE(SUM(i.stock), 0) as available_stock
FROM 
    shopping_cart sc
JOIN 
    products p ON sc.product_id = p.product_id
JOIN 
    categories c ON p.category_id = c.category_id
JOIN 
    dynamic_pricing dp ON p.product_id = dp.product_id
LEFT JOIN
    inventory i ON p.product_id = i.product_id
GROUP BY
    sc.product_id,
    sc.product_name,
    c.category_id,
    c.category_name,
    dp.adjusted_price;

COMMENT ON VIEW dynamic_price_shopping_cart IS 'Complete marketplace view of products in shopping carts with real-time pricing and availability. Consolidates live cart contents with optimized pricing and inventory levels to support checkout processes, pricing decisions, and fulfillment readiness. Provides the definitive state of cart items with current market pricing for commerce operations.';
COMMENT ON COLUMN dynamic_price_shopping_cart.product_id IS 'Unique identifier for products currently in customer shopping carts. Links cart items to their master product records for pricing calculations and inventory availability checks.';
COMMENT ON COLUMN dynamic_price_shopping_cart.product_name IS 'Customer-facing display name for products in shopping carts. Used for cart visualization, order confirmation, and customer communication throughout the purchase process.';
COMMENT ON COLUMN dynamic_price_shopping_cart.category_id IS 'Category classification for products in shopping carts. Enables category-based pricing rules, promotional targeting, and cart analysis for merchandising decisions.';
COMMENT ON COLUMN dynamic_price_shopping_cart.category_name IS 'Descriptive category name for products in shopping carts. Supports customer-facing cart organization and internal analytics for category performance in conversion metrics.';
COMMENT ON COLUMN dynamic_price_shopping_cart.price IS 'Current algorithmically optimized selling price for products in shopping carts. Reflects real-time market conditions, demand patterns, and competitive positioning to maximize revenue while maintaining competitive market position.';
COMMENT ON COLUMN dynamic_price_shopping_cart.available_stock IS 'Total available inventory quantity across all warehouses for products in shopping carts. Aggregated stock levels enable availability validation, fulfillment decisions, and out-of-stock notifications during the checkout process.';

CREATE VIEW category_totals AS
WITH MUTUALLY RECURSIVE
  rollup(category_id int, total numeric(20,10), item_count int) AS (
    -- Base: calculate each category's direct total and item count
    SELECT
      c.category_id,
      COALESCE(SUM(d.price), 0)::numeric(20,10),
      COUNT(d.price)
    FROM categories c
    LEFT JOIN dynamic_price_shopping_cart d
      ON c.category_id = d.category_id
    GROUP BY c.category_id

    UNION ALL

    -- Recursive: bubble each category's totals upward to its parent
    SELECT
      c.parent_id,
      r.total,
      r.item_count
    FROM rollup r
    JOIN categories c
      ON r.category_id = c.category_id
    WHERE c.parent_id IS NOT NULL
  ),

  totals(category_id int, total numeric(20,10), item_count int) AS (
    SELECT
      c.category_id,
      SUM(r.total)::numeric(20,10) AS total,
      SUM(r.item_count) AS item_count
    FROM categories c
    JOIN rollup r
      ON c.category_id = r.category_id
    GROUP BY c.category_id
    HAVING SUM(r.item_count) > 0
  ),

  has_subcategories(category_id int, has_subcategory boolean) AS (
    SELECT
      a.category_id,
      count(*) FILTER (WHERE b.parent_id IS NOT NULL) > 0 AS has_subcategory
    FROM categories a
    LEFT JOIN categories b ON a.category_id = b.parent_id
    GROUP BY a.category_id
  ),

  others(category_id int, total numeric(20, 10), item_count int) AS (
    SELECT
      c.category_id,
      COALESCE(SUM(d.price), 0)::numeric(20,10) AS total,
      COUNT(d.price) AS item_count
    FROM categories c
    JOIN has_subcategories hs ON c.category_id = hs.category_id AND hs.has_subcategory
    LEFT JOIN dynamic_price_shopping_cart d
      ON c.category_id = d.category_id
    GROUP BY c.category_id
    HAVING COUNT(d.price) > 0
  )

SELECT
  t.category_id,
  c.parent_id,
  s.has_subcategory,
  c.category_name,
  t.total,
  t.item_count
FROM totals t
JOIN categories c USING (category_id)
JOIN has_subcategories s USING (category_id)

UNION ALL

SELECT
  1000 + category_id,
  category_id,
  false,
  'Other',
  total,
  item_count
FROM others;

COMMENT ON VIEW category_totals IS 'Comprehensive hierarchical view of product category financial performance and inventory depth. Aggregates sales totals and item counts across category trees, including both direct category performance and rolled-up metrics from subcategories. Provides essential insights for merchandising decisions, category management, and inventory allocation strategies.';
COMMENT ON COLUMN category_totals.category_id IS 'Primary identifier for the product category or synthetic Other category. Values above 1000 represent aggregated Other categories that consolidate direct items within parent categories that also contain subcategories.';
COMMENT ON COLUMN category_totals.parent_id IS 'Reference to the parent category in the hierarchical structure. Enables drill-down navigation and understanding of category relationships for merchandising and organizational purposes.';
COMMENT ON COLUMN category_totals.has_subcategory IS 'Boolean indicator of whether this category contains child categories. Distinguishes between leaf categories and parent categories for navigation logic and merchandising organization.';
COMMENT ON COLUMN category_totals.category_name IS 'Display name for the category or Other designation. Shows either the canonical category name or Other for synthetic categories that aggregate direct items within parent categories.';
COMMENT ON COLUMN category_totals.total IS 'Total monetary value of all items within this category including rolled-up values from subcategories. Represents the complete financial performance of the category hierarchy for revenue analysis and category profitability assessment.';
COMMENT ON COLUMN category_totals.item_count IS 'Total count of individual items within this category including items from subcategories. Provides inventory depth metrics for category management and merchandise planning decisions.';

CREATE INDEX IF NOT EXISTS dynamic_pricing_product_id_idx ON dynamic_pricing (product_id);

CREATE DEFAULT INDEX IF NOT EXISTS dynamic_price_shopping_cart_idx ON dynamic_price_shopping_cart;
CREATE DEFAULT INDEX IF NOT EXISTS category_totals_category_id_idx ON category_totals;

CREATE INDEX IF NOT EXISTS category_totals_parent_id_idx ON category_totals (parent_id);
CREATE INDEX IF NOT EXISTS heartbeats_idx ON heartbeats (id DESC);
