import React, { useState, useEffect } from 'react';
import { Text, Grid, Paper, Group, Divider, Switch } from '@mantine/core';
import {useTranslation} from "react-i18next";
import i18n from "../i18n";
import ComposableDataProductGraph from "./ComposableDataProductGraph";
import HierarchicalDataProductGraph from "./HierarchicalDataProductGraph";

const ShoppingCart = ({ onLatencyUpdate }) => {
    const { t } = useTranslation();

    // Existing state for cart items and error handling.
    const [cartItems, setCartItems] = useState([]);
    const [categorySubtotals, setCategorySubtotals] = useState([]);
    const [error, setError] = useState(null);
    const [requestTime, setRequestTime] = useState(null);
    const [cartTotal, setCartTotal] = useState(0);
    const [categoriesTotal, setCategoriesTotal] = useState(0);
    const [showSummaryView, setShowSummaryView] = useState(false);

    // New state: keep track of which category IDs are expanded.
    const [expandedCategories, setExpandedCategories] = useState([]);

    // Function to toggle a category's expanded state.
    const toggleCategory = (categoryId) => {
        setExpandedCategories((prevExpanded) =>
            prevExpanded.includes(categoryId)
                ? prevExpanded.filter((id) => id !== categoryId)
                : [...prevExpanded, categoryId]
        );
    };

    useEffect(() => {
        const fetchData = async () => {
            try {
                const startTime = performance.now();
                // Pass the expanded category IDs as a comma‐separated list.
                const expandedParam = expandedCategories.join(',');
                const url = `http://localhost:8000/api/shopping-cart?expanded=${expandedParam}`;
                const response = await fetch(url);
                const endTime = performance.now();
                const latency = Math.round(endTime - startTime);
                setRequestTime(latency);
                if (onLatencyUpdate) {
                    onLatencyUpdate(latency);
                }

                if (!response.ok) {
                    throw new Error('Failed to fetch cart data');
                }
                const data = await response.json();
                setCartItems(data.cart_items);
                setCategorySubtotals(data.category_subtotals);
                setCartTotal(data.cart_total);
                setCategoriesTotal(data.categories_total);
            } catch (err) {
                setError(err.message);
                console.error('Error fetching data:', err);
            }
        };

        // Initial fetch and polling every second.
        fetchData();
        const intervalId = setInterval(fetchData, 1000);
        return () => clearInterval(intervalId);
    }, [onLatencyUpdate, expandedCategories]);

    if (error) {
        return <div className="text-red-600">Error: {error}</div>;
    }

    // Recursive function to render category rows.
    const renderCategoryRows = (parentId = null, level = 0) => {
        // Filter categories that have the given parent_id.
        return categorySubtotals
            .filter((cat) => cat.parent_id === parentId)
            .map((cat) => {
                const isExpanded = expandedCategories.includes(cat.category_id);
                // Recursively get child rows for this category.
                const childRows = renderCategoryRows(cat.category_id, level + 1);
                return (
                    <React.Fragment key={cat.category_id}>
                        <tr
                            onClick={() => toggleCategory(cat.category_id)}
                            style={{
                                cursor: childRows.length > 0 ? 'pointer' : 'default',
                                backgroundColor: isExpanded ? 'rgba(255,255,255,0.05)' : 'transparent',
                            }}
                        >
                            <td
                                style={{
                                    padding: '12px 16px',
                                    paddingLeft: `${level * 20 + 16}px`, // Increase left padding for each level
                                    color: '#BCB9C0',
                                    fontSize: '0.875rem',
                                }}
                            >
                                {/* If there are children, show an expansion indicator */}
                                {cat.has_subcategory && (isExpanded ? '▼ ' : '► ')}
                                {cat.category_name}
                            </td>
                            <td
                                style={{
                                    padding: '12px 16px',
                                    textAlign: 'right',
                                    color: '#BCB9C0',
                                    fontSize: '0.875rem',
                                }}
                            >
                                {cat.item_count}
                            </td>
                            <td
                                style={{
                                    padding: '12px 16px',
                                    textAlign: 'right',
                                    color: '#228be6',
                                    fontSize: '0.875rem',
                                    fontWeight: 500,
                                }}
                            >
                                ${cat.subtotal.toFixed(2)}
                            </td>
                        </tr>
                        {/* Render children only if this category is expanded */}
                        {isExpanded && childRows}
                    </React.Fragment>
                );
            });
    };

    return (
        <div>
            {requestTime !== null && (
                <Group position="apart" style={{ marginBottom: '8px', width: '100%' }}>
                    <Switch
                        label="Show Summary View"
                        checked={showSummaryView}
                        onChange={(event) => setShowSummaryView(event.currentTarget.checked)}
                        size="sm"
                        color="blue"
                        styles={{
                            label: {
                                color: '#BCB9C0'
                            }
                        }}
                    />
                    <Text
                        size="xs"
                        style={{ 
                            color: '#9d4edd', 
                            fontWeight: 500,
                            marginLeft: 'auto'
                        }}
                    >
                        Request time: {requestTime}ms
                    </Text>
                </Group>
            )}

            {/* New Data Product Lineage Cards - Always shown */}
            <Grid style={{ marginBottom: '16px' }}>
                <Grid.Col span={6}>
                    <Paper p="md" withBorder style={{ 
                        backgroundColor: 'rgb(13, 17, 22)',
                        border: '1px solid rgba(255, 255, 255, 0.1)'
                    }}>
                        <Text size="sm" weight={500} mb="md" style={{ color: '#BCB9C0' }}>{ t("collectionType") } Data Product</Text>
                        <pre style={{ 
                            fontFamily: 'Inter, monospace',
                            fontSize: '14px',
                            lineHeight: '1.5',
                            whiteSpace: 'pre',
                            overflow: 'auto',
                            padding: '12px',
                            backgroundColor: 'rgba(255, 255, 255, 0.05)',
                            borderRadius: '4px',
                            color: '#BCB9C0',
                            margin: 0
                        }}>
                        <ComposableDataProductGraph/>
                        </pre>
                    </Paper>
                </Grid.Col>
                {showSummaryView && (
                    <Grid.Col span={6}>
                        <Paper p="md" withBorder style={{ 
                            backgroundColor: 'rgb(13, 17, 22)',
                            border: '1px solid rgba(255, 255, 255, 0.1)'
                        }}>
                            <Text size="sm" weight={500} mb="md" style={{ color: '#BCB9C0' }}>{ t("groupingType") } Hierarchy Data Product</Text>
                            <pre style={{ 
                                fontFamily: 'Inter, monospace',
                                fontSize: '14px',
                                lineHeight: '1.5',
                                whiteSpace: 'pre',
                                overflow: 'auto',
                                padding: '12px',
                                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                borderRadius: '4px',
                                color: '#BCB9C0',
                                margin: 0
                            }}>
                                <HierarchicalDataProductGraph/>
                            </pre>
                        </Paper>
                    </Grid.Col>
                )}
            </Grid>

            {error ? (
                <Paper p="md" withBorder style={{
                    backgroundColor: 'rgba(255, 0, 0, 0.1)',
                    border: '1px solid rgba(255, 0, 0, 0.2)',
                    borderRadius: '4px',
                    marginBottom: '16px'
                }}>
                    <Text color="red" size="sm">Error loading { t("collectionType") } data: {error}</Text>
                </Paper>
            ) : (
                <>
                    <Grid style={{ marginBottom: '8px' }}>
                        {/* Collection Type Column */}
                        <Grid.Col span={showSummaryView ? 6 : 12}>
                            <Text size="md" weight={500} mb="sm" style={{ color: '#BCB9C0' }}>
                                { t("collectionType") }
                            </Text>
                            <div className="overflow-x-auto">
                                {/* Cart Items Table */}
                                <table
                                    style={{
                                        width: '100%',
                                        borderCollapse: 'collapse',
                                        backgroundColor: 'rgb(13, 17, 22)',
                                        border: '1px solid rgba(255, 255, 255, 0.1)',
                                        borderRadius: '4px',
                                        display: 'flex',
                                        flexDirection: 'column',
                                    }}
                                >
                                    <thead style={{ display: 'block' }}>
                                    <tr
                                        style={{
                                            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                                            display: 'flex',
                                            width: '100%',
                                        }}
                                    >
                                        <th
                                            style={{
                                                padding: '12px 16px',
                                                textAlign: 'left',
                                                color: '#BCB9C0',
                                                fontSize: '0.875rem',
                                                fontWeight: 600,
                                                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                                flex: '1',
                                            }}
                                        >
                                            Prod. ID
                                        </th>
                                        <th
                                            style={{
                                                padding: '12px 16px',
                                                textAlign: 'left',
                                                color: '#BCB9C0',
                                                fontSize: '0.875rem',
                                                fontWeight: 600,
                                                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                                flex: '2',
                                            }}
                                        >
                                            Product Name
                                        </th>
                                        <th
                                            style={{
                                                padding: '12px 16px',
                                                textAlign: 'left',
                                                color: '#BCB9C0',
                                                fontSize: '0.875rem',
                                                fontWeight: 600,
                                                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                                flex: '1',
                                            }}
                                        >
                                            { t("groupingType") }
                                        </th>
                                        <th
                                            style={{
                                                padding: '12px 16px',
                                                textAlign: 'right',
                                                color: '#BCB9C0',
                                                fontSize: '0.875rem',
                                                fontWeight: 600,
                                                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                                flex: '1',
                                            }}
                                        >
                                            Stock
                                        </th>
                                        <th
                                            style={{
                                                padding: '12px 16px',
                                                textAlign: 'right',
                                                color: '#BCB9C0',
                                                fontSize: '0.875rem',
                                                fontWeight: 600,
                                                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                                flex: '1',
                                            }}
                                        >
                                            Price
                                        </th>
                                    </tr>
                                    </thead>
                                    <tbody
                                        style={{
                                            display: 'block',
                                            maxHeight: '400px',
                                            overflowY: 'auto',
                                            overflowX: 'hidden',
                                        }}
                                    >
                                    {cartItems.map((item, index) => (
                                        <tr
                                            key={index}
                                            style={{
                                                borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                                                display: 'flex',
                                                width: '100%'
                                            }}
                                        >
                                            <td
                                                style={{
                                                    padding: '12px 16px',
                                                    color: '#BCB9C0',
                                                    fontSize: '0.875rem',
                                                    flex: '1',
                                                }}
                                            >
                                                {item.product_id}
                                            </td>
                                            <td
                                                style={{
                                                    padding: '12px 16px',
                                                    color: '#BCB9C0',
                                                    fontSize: '0.875rem',
                                                    flex: '2',
                                                }}
                                            >
                                                {item.product_name}
                                            </td>
                                            <td
                                                style={{
                                                    padding: '12px 16px',
                                                    color: '#BCB9C0',
                                                    fontSize: '0.875rem',
                                                    flex: '1',
                                                }}
                                            >
                                                {item.category_name}
                                            </td>
                                            <td
                                                style={{
                                                    padding: '12px 16px',
                                                    textAlign: 'right',
                                                    color: item.available_stock > 0 ? '#40c057' : '#fa5252',
                                                    fontSize: '0.875rem',
                                                    fontWeight: 500,
                                                    flex: '1',
                                                }}
                                            >
                                                {item.available_stock}
                                            </td>
                                            <td
                                                style={{
                                                    padding: '12px 16px',
                                                    textAlign: 'right',
                                                    color: '#228be6',
                                                    fontSize: '0.875rem',
                                                    fontWeight: 500,
                                                    flex: '1',
                                                }}
                                            >
                                                ${item.price.toFixed(2)}
                                            </td>
                                        </tr>
                                    ))}
                                    </tbody>
                                </table>
                            </div>
                        </Grid.Col>

                        {/* Category Subtotals Column */}
                        {showSummaryView && (
                            <Grid.Col span={6}>
                                <Text size="md" weight={500} mb="sm" style={{ color: '#BCB9C0' }}>
                                    { t("groupingType") } Subtotals
                                </Text>
                                <table
                                    style={{
                                        width: '100%',
                                        borderCollapse: 'collapse',
                                        backgroundColor: 'rgb(13, 17, 22)',
                                        border: '1px solid rgba(255, 255, 255, 0.1)',
                                        borderRadius: '4px',
                                    }}
                                >
                                    <thead>
                                        <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>
                                            <th
                                                style={{
                                                    padding: '12px 16px',
                                                    textAlign: 'left',
                                                    color: '#BCB9C0',
                                                    fontSize: '0.875rem',
                                                    fontWeight: 600,
                                                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                                }}
                                            >
                                                { t("groupingType") }
                                            </th>
                                            <th
                                                style={{
                                                    padding: '12px 16px',
                                                    textAlign: 'right',
                                                    color: '#BCB9C0',
                                                    fontSize: '0.875rem',
                                                    fontWeight: 600,
                                                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                                }}
                                            >
                                                Items
                                            </th>
                                            <th
                                                style={{
                                                    padding: '12px 16px',
                                                    textAlign: 'right',
                                                    color: '#BCB9C0',
                                                    fontSize: '0.875rem',
                                                    fontWeight: 600,
                                                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                                }}
                                            >
                                                Subtotal
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>{renderCategoryRows(null, 0)}</tbody>
                                </table>
                            </Grid.Col>
                        )}
                    </Grid>
                    
                    {/* Totals Row */}
                    <Grid style={{ marginTop: 0 }}>
                        <Grid.Col span={showSummaryView ? 6 : 12}>
                            <Paper p="md" style={{
                                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                borderRadius: '4px'
                            }}>
                                <Group position="apart" style={{ paddingRight: '16px' }}>
                                    <Text weight={600} size="sm" style={{ color: '#BCB9C0', flex: 3 }}>{ t("collectionType" )} Total:</Text>
                                    <Text weight={600} size="lg" style={{ color: '#228be6', flex: 1, textAlign: 'right' }}>
                                        ${cartTotal.toFixed(2)}
                                    </Text>
                                </Group>
                            </Paper>
                        </Grid.Col>
                        {showSummaryView && (
                            <Grid.Col span={6}>
                                <Paper p="md" style={{
                                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                    border: '1px solid rgba(255, 255, 255, 0.1)',
                                    borderRadius: '4px'
                                }}>
                                    <Group position="apart" style={{ paddingRight: '16px' }}>
                                        <Text weight={600} size="sm" style={{ color: '#BCB9C0', flex: 2 }}>{ t("groupingType") } Subtotals:</Text>
                                        <Text weight={600} size="lg" style={{ color: '#228be6', flex: 1, textAlign: 'right' }}>
                                            ${categoriesTotal.toFixed(2)}
                                        </Text>
                                    </Group>
                                </Paper>
                            </Grid.Col>
                        )}
                    </Grid>
                </>
            )}

            <Divider my="xl" style={{ borderColor: 'rgba(255, 255, 255, 0.1)' }} />
        </div>
    );
};

export default ShoppingCart;