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

CREATE VIEW dynamic_price_shopping_cart AS SELECT 
  sc.product_id,  
  sc.product_name,
  c.category_id,
    c.category_name,
    dp.adjusted_price AS price
FROM 
    shopping_cart sc
JOIN 
    products p ON sc.product_id = p.product_id
JOIN 
    categories c ON p.category_id = c.category_id
JOIN 
dynamic_pricing dp ON p.product_id = dp.product_id
;


WITH MUTUALLY RECURSIVE rollup (category_id int, total numeric(30, 2)) AS (
    SELECT category_id, sum(price) AS total
    FROM shopping_cart
    GROUP BY category_id
            
    UNION ALL
    
    SELECT parent_id AS category_id, sum(total) AS total
    FROM rollup AS r
    JOIN categories AS c ON r.category_id = c.parent_id
    GROUP BY parent_id
)

SELECT category_id, category_name, total
FROM rollup
INNER JOIN categories USING (category_id)
WHERE total::text <> 'Infinity';

CREATE INDEX IF NOT EXISTS dynamic_pricing_product_id_idx ON dynamic_pricing (product_id);

CREATE INDEX IF NOT EXISTS hierarchical_totals_category_id_idx ON hierarchical_totals (category_id);

CREATE DEFAULT INDEX IF NOT EXISTS dynamic_price_shopping_cart_idx ON dynamic_price_shopping_cart;


CREATE INDEX IF NOT EXISTS heartbeats_idx ON heartbeats (id DESC);
