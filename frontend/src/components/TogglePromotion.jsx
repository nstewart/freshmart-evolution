import React, { useState } from 'react';
import { Button, Text, NumberInput, Group } from '@mantine/core';

const TogglePromotion = () => {
    const [productId, setProductId] = useState('');
    const [status, setStatus] = useState(null);
    const [error, setError] = useState(null);

    const handleToggle = async () => {
        if (!productId) {
            setError('Please enter a product ID');
            return;
        }

        try {
            const response = await fetch(`http://localhost:8000/toggle-promotion/${productId}`, {
                method: 'POST',
            });

            const result = await response.json();
            
            if (!response.ok || result.status === 'error') {
                throw new Error(result.message || 'Failed to toggle promotion');
            }

            setStatus(`Successfully ${result.active ? 'enabled' : 'disabled'} promotion for product ${productId}`);
            setError(null);
        } catch (err) {
            setError(err.message);
            setStatus(null);
        }
    };

    return (
        <div>
            <Text size="lg" weight={600} mb="md" style={{ color: '#BCB9C0' }}>Toggle Promotion</Text>
            
            <div style={{ 
                padding: '16px',
                backgroundColor: 'rgb(13, 17, 22)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '4px'
            }}>
                <Group spacing="md">
                    <NumberInput
                        value={productId}
                        onChange={(val) => setProductId(val)}
                        placeholder="Enter Product ID"
                        label="Product ID"
                        required
                        style={{ flex: 1 }}
                        styles={{
                            label: {
                                color: '#BCB9C0',
                                marginBottom: '8px'
                            },
                            input: {
                                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                color: '#BCB9C0',
                                border: '1px solid rgba(255, 255, 255, 0.1)'
                            }
                        }}
                    />
                    <Button 
                        onClick={handleToggle}
                        style={{ marginTop: '25px' }}
                    >
                        Toggle Promotion
                    </Button>
                </Group>

                {status && (
                    <Text color="green" size="sm" mt="sm">
                        {status}
                    </Text>
                )}
                
                {error && (
                    <Text color="red" size="sm" mt="sm">
                        Error: {error}
                    </Text>
                )}
            </div>
        </div>
    );
};

export default TogglePromotion; 
