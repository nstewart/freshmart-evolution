import React, { useState, useEffect } from 'react';
import { Paper, Text } from '@mantine/core';

const ShoppingCart = () => {
    const [cartItems, setCartItems] = useState([]);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchCartItems = async () => {
            try {
                const response = await fetch('http://localhost:8000/api/shopping-cart');
                if (!response.ok) {
                    throw new Error('Failed to fetch cart items');
                }
                const data = await response.json();
                setCartItems(data);
            } catch (err) {
                setError(err.message);
                console.error('Error fetching cart items:', err);
            }
        };

        // Initial fetch
        fetchCartItems();

        // Set up polling interval
        const intervalId = setInterval(fetchCartItems, 1000);

        // Cleanup
        return () => clearInterval(intervalId);
    }, []);

    if (error) {
        return <div className="text-red-600">Error: {error}</div>;
    }

    return (
        <Paper p="xl" withBorder style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}>
            <Text size="lg" weight={600} mb="md" style={{ color: '#BCB9C0' }}>Shopping Cart</Text>
            <div className="overflow-x-auto">
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
                            }}>Product Name</th>
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
                            }}>Price</th>
                        </tr>
                    </thead>
                    <tbody>
                        {cartItems.map((item, index) => (
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
                                }}>{item.product_name}</td>
                                <td style={{ 
                                    padding: '12px 16px', 
                                    color: '#BCB9C0',
                                    fontSize: '0.875rem'
                                }}>{item.category_name}</td>
                                <td style={{ 
                                    padding: '12px 16px', 
                                    textAlign: 'right',
                                    color: '#228be6',
                                    fontSize: '0.875rem',
                                    fontWeight: 500
                                }}>${Number(item.price).toFixed(2)}</td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot>
                        <tr style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}>
                            <td 
                                colSpan="2" 
                                style={{ 
                                    padding: '12px 16px', 
                                    textAlign: 'right',
                                    color: '#BCB9C0',
                                    fontSize: '0.875rem',
                                    fontWeight: 600
                                }}
                            >Total:</td>
                            <td 
                                style={{ 
                                    padding: '12px 16px', 
                                    textAlign: 'right',
                                    color: '#228be6',
                                    fontSize: '0.875rem',
                                    fontWeight: 600
                                }}
                            >${cartItems.reduce((sum, item) => sum + Number(item.price), 0).toFixed(2)}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </Paper>
    );
};

export default ShoppingCart; 
