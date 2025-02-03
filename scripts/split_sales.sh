#!/bin/bash

# Exit on error
set -e

echo "Creating reduced data directory..."
mkdir -p data_files/reduced

# Reduce products by half (instead of 1/4) to maintain better data distribution
echo "Reducing products dataset to half size..."
# Save header
head -n 1 data_files/products.csv > data_files/reduced/products.csv
# First ensure product ID 1 is included
grep "^1," data_files/products.csv >> data_files/reduced/products.csv
# Take every other product, excluding product ID 1 if it would be selected again
tail -n +2 data_files/products.csv | grep -v "^1," | sed -n 'p;n' >> data_files/reduced/products.csv

# Get list of remaining product IDs and create a lookup file
echo "Creating product lookup..."
tail -n +2 data_files/reduced/products.csv | cut -d',' -f1 | sort -n > data_files/reduced/remaining_products.txt

# Filter promotions to only include remaining products
echo "Filtering promotions..."
head -n 1 data_files/promotions.csv > data_files/reduced/promotions.csv
awk -F, 'NR==FNR {products[$1]=1; next} FNR==1 {next} $2 in products' \
    data_files/reduced/remaining_products.txt data_files/promotions.csv >> data_files/reduced/promotions.csv

# Filter inventory to only include remaining products
echo "Filtering and adjusting inventory..."
head -n 1 data_files/inventory.csv > data_files/reduced/inventory.csv
awk -F, 'NR==FNR {products[$1]=1; next} FNR==1 {next} $2 in products {
    # Reduce stock by half and round to nearest integer
    new_stock = int(($3 + 1) / 2);
    print $1 "," $2 "," new_stock "," $4 "," $5
}' data_files/reduced/remaining_products.txt data_files/inventory.csv >> data_files/reduced/inventory.csv

# Copy categories and suppliers as they are referenced by products
echo "Copying reference tables..."
cp data_files/categories.csv data_files/reduced/
cp data_files/suppliers.csv data_files/reduced/

# Create reduced sales chunks directory
mkdir -p data_files/reduced/sales_chunks

# Process sales chunks to only include remaining products and sample 1/2 of those records
echo "Processing sales chunks..."
for chunk in data_files/sales_chunks/chunk_*; do
    if [ -f "$chunk" ]; then
        filename=$(basename "$chunk")
        echo "Processing $filename..."
        head -n 1 "$chunk" > "data_files/reduced/sales_chunks/$filename"
        awk -F, 'NR==FNR {products[$1]=1; next} FNR==1 {next} 
            $2 in products && ($2 == "1" || $1 % 2 == 0) {print $0}' \
            data_files/reduced/remaining_products.txt "$chunk" >> "data_files/reduced/sales_chunks/$filename"
    fi
done

# Clean up temporary files
rm -f data_files/reduced/remaining_products.txt

echo "Data reduction complete! New files are in data_files/reduced/"
echo "Products reduced to half size (including product ID 1), and sales reduced to approximately 1/4 of original size while maintaining referential integrity." 