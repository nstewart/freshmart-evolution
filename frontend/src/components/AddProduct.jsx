import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Text } from '@mantine/core';

const AddProduct = () => {
    const [categories, setCategories] = useState([]);
    const [formData, setFormData] = useState({
        product_name: '',
        category_id: '',
        price: ''
    });
    const [message, setMessage] = useState('');

    useEffect(() => {
        // Fetch categories when component mounts
        const fetchCategories = async () => {
            try {
                const response = await axios.get('http://localhost:8000/api/categories');
                setCategories(response.data);
            } catch (error) {
                console.error('Error fetching categories:', error);
                setMessage('Failed to load categories');
            }
        };

        fetchCategories();
    }, []);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: name === 'category_id' ? parseInt(value) : name === 'price' ? parseFloat(value) : value
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            const response = await axios.post('http://localhost:8000/api/products', formData);
            setMessage('Product added successfully!');
            // Clear form
            setFormData({
                product_name: '',
                category_id: '',
                price: ''
            });
        } catch (error) {
            console.error('Error adding product:', error);
            setMessage('Failed to add product');
        }
    };

    return (
        <div>
            <Text size="lg" weight={600} mb="md" style={{ color: '#BCB9C0' }}>Add New Product</Text>
            {message && (
                <div style={{ 
                    padding: '12px', 
                    marginBottom: '16px', 
                    borderRadius: '4px',
                    backgroundColor: message.includes('Failed') ? 'rgba(255, 0, 0, 0.1)' : 'rgba(0, 255, 0, 0.1)',
                    color: message.includes('Failed') ? '#ff4d4f' : '#52c41a',
                    border: `1px solid ${message.includes('Failed') ? '#ff4d4f' : '#52c41a'}`
                }}>
                    {message}
                </div>
            )}
            <form onSubmit={handleSubmit} style={{ 
                backgroundColor: 'rgb(13, 17, 22)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '4px',
                padding: '16px'
            }}>
                <div style={{ marginBottom: '16px' }}>
                    <label style={{ 
                        display: 'block',
                        marginBottom: '8px',
                        color: '#BCB9C0',
                        fontSize: '14px',
                        fontWeight: 500
                    }}>
                        Product Name
                    </label>
                    <input
                        type="text"
                        name="product_name"
                        value={formData.product_name}
                        onChange={handleChange}
                        required
                        style={{
                            width: '100%',
                            padding: '8px 12px',
                            backgroundColor: 'rgba(255, 255, 255, 0.05)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            borderRadius: '4px',
                            color: '#BCB9C0',
                            fontSize: '14px',
                            '&:focus': {
                                borderColor: '#228be6',
                                outline: 'none'
                            }
                        }}
                    />
                </div>
                <div style={{ marginBottom: '16px' }}>
                    <label style={{ 
                        display: 'block',
                        marginBottom: '8px',
                        color: '#BCB9C0',
                        fontSize: '14px',
                        fontWeight: 500
                    }}>
                        Category
                    </label>
                    <select
                        name="category_id"
                        value={formData.category_id}
                        onChange={handleChange}
                        required
                        style={{
                            width: '100%',
                            padding: '8px 12px',
                            backgroundColor: 'rgba(255, 255, 255, 0.05)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            borderRadius: '4px',
                            color: '#BCB9C0',
                            fontSize: '14px',
                            '&:focus': {
                                borderColor: '#228be6',
                                outline: 'none'
                            }
                        }}
                    >
                        <option value="">Select a category</option>
                        {categories.map(category => (
                            <option key={category.category_id} value={category.category_id}>
                                {category.category_name}
                            </option>
                        ))}
                    </select>
                </div>
                <div style={{ marginBottom: '16px' }}>
                    <label style={{ 
                        display: 'block',
                        marginBottom: '8px',
                        color: '#BCB9C0',
                        fontSize: '14px',
                        fontWeight: 500
                    }}>
                        Price
                    </label>
                    <input
                        type="number"
                        name="price"
                        value={formData.price}
                        onChange={handleChange}
                        required
                        step="0.01"
                        min="0"
                        style={{
                            width: '100%',
                            padding: '8px 12px',
                            backgroundColor: 'rgba(255, 255, 255, 0.05)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            borderRadius: '4px',
                            color: '#BCB9C0',
                            fontSize: '14px',
                            '&:focus': {
                                borderColor: '#228be6',
                                outline: 'none'
                            }
                        }}
                    />
                </div>
                <button
                    type="submit"
                    style={{
                        width: '100%',
                        padding: '10px',
                        backgroundColor: '#228be6',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        fontSize: '14px',
                        fontWeight: 500,
                        cursor: 'pointer',
                        '&:hover': {
                            backgroundColor: '#1c7ed6'
                        }
                    }}
                >
                    Add Product
                </button>
            </form>
        </div>
    );
};

export default AddProduct; 