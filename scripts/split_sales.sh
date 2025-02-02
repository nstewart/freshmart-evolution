#!/bin/bash

# Exit on error
set -e

echo "Creating reduced data directory..."
mkdir -p data_files/reduced

# Copy all non-sales files as-is to maintain referential integrity
cp data_files/categories.csv data_files/reduced/
cp data_files/suppliers.csv data_files/reduced/
cp data_files/products.csv data_files/reduced/
cp data_files/promotions.csv data_files/reduced/

# Create reduced sales chunks directory
mkdir -p data_files/reduced/sales_chunks

# Process each sales chunk and take every other line
for chunk in data_files/sales_chunks/chunk_*; do
    if [ -f "$chunk" ]; then
        filename=$(basename "$chunk")
        echo "Processing $filename..."
        # Save header line
        head -n 1 "$chunk" > "data_files/reduced/sales_chunks/$filename"
        # Take every other line after header (odd-numbered lines)
        tail -n +2 "$chunk" | sed -n 'p;n' >> "data_files/reduced/sales_chunks/$filename"
    fi
done

# Adjust inventory proportionally
echo "Adjusting inventory levels..."
# Save header
head -n 1 data_files/inventory.csv > data_files/reduced/inventory.csv
# Reduce stock levels by roughly half for each product
tail -n +2 data_files/inventory.csv | awk -F',' '{
    # Divide stock by 2 and round to nearest integer
    $3 = int(($3 + 1) / 2);
    # Print the modified line
    print $1 "," $2 "," $3 "," $4 "," $5
}' >> data_files/reduced/inventory.csv

echo "Data reduction complete! New files are in data_files/reduced/" 