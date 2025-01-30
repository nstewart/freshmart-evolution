-- Add more products (100K products)
INSERT INTO products (product_name, base_price, category_id, supplier_id, available)
SELECT 
    'Product ' || i || ' ' || (
        CASE (i % 5) 
            WHEN 0 THEN 'Premium'
            WHEN 1 THEN 'Standard'
            WHEN 2 THEN 'Basic'
            WHEN 3 THEN 'Cheap'
            WHEN 4 THEN 'Luxury'
        END
    ),
    50 + (random() * 950)::numeric(10,2),  -- prices between 50 and 1000
    1 + (i % 10),  -- 10 categories
    1 + (i % 5),   -- 5 suppliers
    random() < 0.8  -- 80% chance of being available
FROM generate_series(1, 100000) i
ON CONFLICT DO NOTHING;

-- Create a temporary table with valid product IDs
CREATE TEMP TABLE valid_product_ids AS
SELECT product_id FROM products;

-- Add sales history in batches (10M sales records)
DO $$
DECLARE
    batch_size INT := 1000000;  -- 1M records per batch
    total_records INT := 10000000;  -- 10M total records
    batch INT;
BEGIN
    FOR batch IN 1..10 LOOP
        RAISE NOTICE 'Inserting sales batch % of 10...', batch;
        INSERT INTO sales (product_id, sale_date, price, sale_price)
        SELECT 
            product_id,
            NOW() - (random() * 365 * interval '1 day'),
            (random() * 1000)::numeric(10,2),
            (random() * 800)::numeric(10,2)
        FROM (
            SELECT product_id 
            FROM valid_product_ids 
            ORDER BY random() 
            LIMIT batch_size
        ) random_products;
        RAISE NOTICE 'Completed sales batch %', batch;
    END LOOP;
END $$;

-- Add promotions (500K promotions)
DO $$
DECLARE
    batch_size INT := 100000;  -- 100K records per batch
    total_records INT := 500000;  -- 500K total records
    batch INT;
BEGIN
    FOR batch IN 1..5 LOOP
        RAISE NOTICE 'Inserting promotions batch % of 5...', batch;
        INSERT INTO promotions (product_id, promotion_discount, active, updated_at)
        SELECT 
            product_id,
            (random() * 50)::numeric(10,2),
            random() < 0.3,
            NOW() - (random() * 30 * interval '1 day')
        FROM (
            SELECT product_id 
            FROM valid_product_ids 
            ORDER BY random() 
            LIMIT batch_size
        ) random_products;
        RAISE NOTICE 'Completed promotions batch %', batch;
    END LOOP;
END $$;

-- Add inventory records (1M inventory records)
DO $$
DECLARE
    batch_size INT := 200000;  -- 200K records per batch
    total_records INT := 1000000;  -- 1M total records
    batch INT;
BEGIN
    FOR batch IN 1..5 LOOP
        RAISE NOTICE 'Inserting inventory batch % of 5...', batch;
        INSERT INTO inventory (product_id, warehouse_id, stock)
        SELECT 
            product_id,
            1 + (row_number() over ())::int % 5 + 1,
            (random() * 1000)::int
        FROM (
            SELECT product_id 
            FROM valid_product_ids 
            ORDER BY random() 
            LIMIT batch_size
        ) random_products;
        RAISE NOTICE 'Completed inventory batch %', batch;
    END LOOP;
END $$;

-- Create indexes to help with query performance
DO $$
BEGIN
    RAISE NOTICE 'Creating indexes...';
END $$;

CREATE INDEX IF NOT EXISTS idx_sales_date_range ON sales (sale_date);
CREATE INDEX IF NOT EXISTS idx_sales_product_date ON sales (product_id, sale_date);
CREATE INDEX IF NOT EXISTS idx_promotions_active_product ON promotions (active, product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_product_warehouse ON inventory (product_id, warehouse_id);

-- Analyze tables to update statistics
DO $$
BEGIN
    RAISE NOTICE 'Analyzing tables...';
END $$;

ANALYZE products;
ANALYZE sales;
ANALYZE promotions;
ANALYZE inventory;

DO $$
BEGIN
    RAISE NOTICE 'Data generation complete!';
END $$; 