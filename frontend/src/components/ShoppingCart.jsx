import React, { useState, useEffect } from 'react';
import { Text } from '@mantine/core';

const ShoppingCart = ({ onLatencyUpdate }) => {
    const [cartItems, setCartItems] = useState([]);
    const [categorySubtotals, setCategorySubtotals] = useState([]);
    const [error, setError] = useState(null);
    const [requestTime, setRequestTime] = useState(null);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const startTime = performance.now();
                // Fetch cart data (includes both items and subtotals)
                const response = await fetch('http://localhost:8000/api/shopping-cart');
                const endTime = performance.now();
                const latency = Math.round(endTime - startTime);
                setRequestTime(latency);
                // Notify parent component of the latency
                if (onLatencyUpdate) {
                    onLatencyUpdate(latency);
                }
                
                if (!response.ok) {
                    throw new Error('Failed to fetch cart data');
                }
                const data = await response.json();
                setCartItems(data.cart_items);
                setCategorySubtotals(data.category_subtotals);
            } catch (err) {
                setError(err.message);
                console.error('Error fetching data:', err);
            }
        };

        // Initial fetch
        fetchData();

        // Set up polling interval
        const intervalId = setInterval(fetchData, 1000);

        // Cleanup
        return () => clearInterval(intervalId);
    }, [onLatencyUpdate]);

    if (error) {
        return <div className="text-red-600">Error: {error}</div>;
    }

    return (
        <div>
            {requestTime !== null && (
                <Text size="xs" style={{ color: '#9d4edd', marginBottom: '8px', fontWeight: 500 }}>
                    Request time: {requestTime}ms
                </Text>
            )}
            <div className="overflow-x-auto">
                <table style={{ 
                    width: '100%', 
                    borderCollapse: 'collapse',
                    backgroundColor: 'rgb(13, 17, 22)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '4px',
                    marginBottom: '20px',
                    display: 'flex',
                    flexDirection: 'column'
                }}>
                    <thead style={{ display: 'block' }}>
                        <tr style={{ 
                            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                            display: 'flex',
                            width: '100%'
                        }}>
                            <th style={{ 
                                padding: '12px 16px', 
                                textAlign: 'left', 
                                color: '#BCB9C0', 
                                fontSize: '0.875rem',
                                fontWeight: 600,
                                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                flex: '1'
                            }}>Product ID</th>
                            <th style={{ 
                                padding: '12px 16px', 
                                textAlign: 'left', 
                                color: '#BCB9C0', 
                                fontSize: '0.875rem',
                                fontWeight: 600,
                                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                flex: '2'
                            }}>Product Name</th>
                            <th style={{ 
                                padding: '12px 16px', 
                                textAlign: 'left', 
                                color: '#BCB9C0', 
                                fontSize: '0.875rem',
                                fontWeight: 600,
                                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                flex: '1'
                            }}>Category</th>
                            <th style={{ 
                                padding: '12px 16px', 
                                textAlign: 'right', 
                                color: '#BCB9C0', 
                                fontSize: '0.875rem',
                                fontWeight: 600,
                                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                flex: '1'
                            }}>Price</th>
                        </tr>
                    </thead>
                    <tbody style={{
                        display: 'block',
                        maxHeight: '400px', // This will show roughly 10 items
                        overflowY: 'auto',
                        overflowX: 'hidden'
                    }}>
                        {cartItems.map((item, index) => (
                            <tr 
                                key={index} 
                                style={{ 
                                    borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                                    '&:hover': {
                                        backgroundColor: 'rgba(255, 255, 255, 0.05)'
                                    },
                                    display: 'flex',
                                    width: '100%'
                                }}
                            >
                                <td style={{ 
                                    padding: '12px 16px', 
                                    color: '#BCB9C0',
                                    fontSize: '0.875rem',
                                    flex: '1'
                                }}>{item.product_id}</td>
                                <td style={{ 
                                    padding: '12px 16px', 
                                    color: '#BCB9C0',
                                    fontSize: '0.875rem',
                                    flex: '2'
                                }}>{item.product_name}</td>
                                <td style={{ 
                                    padding: '12px 16px', 
                                    color: '#BCB9C0',
                                    fontSize: '0.875rem',
                                    flex: '1'
                                }}>{item.category_name}</td>
                                <td style={{ 
                                    padding: '12px 16px', 
                                    textAlign: 'right',
                                    color: '#228be6',
                                    fontSize: '0.875rem',
                                    fontWeight: 500,
                                    flex: '1'
                                }}>${Number(item.price).toFixed(2)}</td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot style={{ display: 'block', width: '100%' }}>
                        <tr style={{ 
                            backgroundColor: 'rgba(255, 255, 255, 0.05)',
                            display: 'flex',
                            width: '100%'
                        }}>
                            <td style={{ 
                                padding: '12px 16px', 
                                color: '#BCB9C0',
                                fontSize: '0.875rem',
                                fontWeight: 600,
                                flex: '1'
                            }}></td>
                            <td style={{ 
                                padding: '12px 16px', 
                                color: '#BCB9C0',
                                fontSize: '0.875rem',
                                fontWeight: 600,
                                flex: '2'
                            }}></td>
                            <td style={{ 
                                padding: '12px 16px', 
                                textAlign: 'right',
                                color: '#BCB9C0',
                                fontSize: '0.875rem',
                                fontWeight: 600,
                                flex: '1'
                            }}>Total:</td>
                            <td style={{ 
                                padding: '12px 16px', 
                                textAlign: 'right',
                                color: '#228be6',
                                fontSize: '0.875rem',
                                fontWeight: 600,
                                flex: '1'
                            }}>${cartItems.reduce((sum, item) => sum + Number(item.price), 0).toFixed(2)}</td>
                        </tr>
                    </tfoot>
                </table>

                {/* Category Subtotals Table */}
                <Text size="md" weight={500} mb="sm" style={{ color: '#BCB9C0' }}>Category Subtotals</Text>
                <table style={{ 
                    width: '100%', 
                    borderCollapse: 'collapse',
                    backgroundColor: 'rgb(13, 17, 22)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '4px'
                }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>
                            <th style={{ 
                                padding: '12px 16px', 
                                textAlign: 'left', 
                                color: '#BCB9C0', 
                                fontSize: '0.875rem',
                                fontWeight: 600,
                                backgroundColor: 'rgba(255, 255, 255, 0.05)'
                            }}>Category</th>
                            <th style={{ 
                                padding: '12px 16px', 
                                textAlign: 'right', 
                                color: '#BCB9C0', 
                                fontSize: '0.875rem',
                                fontWeight: 600,
                                backgroundColor: 'rgba(255, 255, 255, 0.05)'
                            }}>Items</th>
                            <th style={{ 
                                padding: '12px 16px', 
                                textAlign: 'right', 
                                color: '#BCB9C0', 
                                fontSize: '0.875rem',
                                fontWeight: 600,
                                backgroundColor: 'rgba(255, 255, 255, 0.05)'
                            }}>Subtotal</th>
                        </tr>
                    </thead>
                    <tbody>
                        {categorySubtotals.map((category, index) => (
                            <tr 
                                key={index} 
                                style={{ 
                                    borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                                    '&:hover': {
                                        backgroundColor: 'rgba(255, 255, 255, 0.05)'
                                    }
                                }}
                            >
                                <td style={{ 
                                    padding: '12px 16px', 
                                    color: '#BCB9C0',
                                    fontSize: '0.875rem'
                                }}>{category.category_name}</td>
                                <td style={{ 
                                    padding: '12px 16px', 
                                    textAlign: 'right',
                                    color: '#BCB9C0',
                                    fontSize: '0.875rem'
                                }}>{category.item_count}</td>
                                <td style={{ 
                                    padding: '12px 16px', 
                                    textAlign: 'right',
                                    color: '#228be6',
                                    fontSize: '0.875rem',
                                    fontWeight: 500
                                }}>${Number(category.subtotal).toFixed(2)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default ShoppingCart; 
