/**
 * eBills API Service
 * 
 * Handles integration with eBills.africa API for airtime, data, and bill payments
 */

const axios = require('axios');

const EBILLS_BASE_URL = 'https://ebills.africa/wp-json';
const AUTH_URL = `${EBILLS_BASE_URL}/jwt-auth/v1/token`;
const API_URL = `${EBILLS_BASE_URL}/api/v2`;

let cachedToken = null;
let tokenExpiry = null;

/**
 * Get access token from eBills API
 */
async function getAccessToken() {
  // Return cached token if still valid (tokens expire after 7 days, refresh every 6 days)
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  const username = process.env.EBILLS_USERNAME;
  const password = process.env.EBILLS_PASSWORD;

  if (!username || !password) {
    throw new Error('eBills credentials not configured. Please set EBILLS_USERNAME and EBILLS_PASSWORD in environment variables.');
  }

  try {
    const response = await axios.post(AUTH_URL, {
      username,
      password,
    }, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (response.data && response.data.token) {
      cachedToken = response.data.token;
      // Set expiry to 6 days (refresh before 7-day expiry)
      tokenExpiry = Date.now() + (6 * 24 * 60 * 60 * 1000);
      return cachedToken;
    }

    throw new Error(response.data?.message || 'Failed to obtain access token');
  } catch (error) {
    if (error.response) {
      const status = error.response.status;
      if (status === 401 || status === 403) {
        throw new Error('Invalid eBills credentials');
      }
      throw new Error(error.response.data?.message || `Authentication failed: ${status}`);
    }
    throw new Error(`Failed to connect to eBills API: ${error.message}`);
  }
}

/**
 * Get headers with Bearer token
 */
async function getHeaders() {
  const token = await getAccessToken();
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Check wallet balance
 */
async function checkBalance() {
  try {
    const headers = await getHeaders();
    const response = await axios.get(`${API_URL}/balance`, { headers });
    
    if (response.data && response.data.code === 'success') {
      return response.data.data;
    }
    
    throw new Error(response.data?.message || 'Failed to retrieve balance');
  } catch (error) {
    if (error.response) {
      throw new Error(error.response.data?.message || `Error checking balance: ${error.response.status}`);
    }
    throw error;
  }
}

/**
 * Purchase airtime
 * @param {Object} params - Purchase parameters
 * @param {string} params.request_id - Unique request ID (max 50 chars)
 * @param {string} params.phone - Phone number (e.g., 08012345678 or +2348012345678)
 * @param {string} params.service_id - Network provider (mtn, airtel, glo, 9mobile)
 * @param {number} params.amount - Airtime amount in NGN
 * @returns {Promise<Object>} Order response
 */
async function purchaseAirtime(params) {
  const { request_id, phone, service_id, amount } = params;

  // Validate parameters
  if (!request_id || !phone || !service_id || !amount) {
    throw new Error('Missing required parameters: request_id, phone, service_id, amount');
  }

  if (request_id.length > 50) {
    throw new Error('Request ID must be 50 characters or less');
  }

  // Normalize phone number (remove +234, ensure it starts with 0)
  let normalizedPhone = phone.replace(/^\+234/, '0').replace(/\s+/g, '');
  if (!normalizedPhone.startsWith('0')) {
    normalizedPhone = '0' + normalizedPhone;
  }

  // Validate amount
  const minAmount = service_id === 'mtn' ? 10 : 50;
  const maxAmount = 50000;

  if (amount < minAmount) {
    throw new Error(`Amount must be at least ₦${minAmount} for ${service_id}`);
  }

  if (amount > maxAmount) {
    throw new Error(`Amount must not exceed ₦${maxAmount}`);
  }

  try {
    const headers = await getHeaders();
    const response = await axios.post(
      `${API_URL}/airtime`,
      {
        request_id,
        phone: normalizedPhone,
        service_id,
        amount: parseInt(amount),
      },
      { headers }
    );

    return response.data;
  } catch (error) {
    if (error.response) {
      const errorData = error.response.data;
      const errorMessage = errorData?.message || `Error purchasing airtime: ${error.response.status}`;
      const errorCode = errorData?.code;

      // Map error codes to user-friendly messages
      if (errorCode === 'insufficient_funds') {
        throw new Error('Insufficient wallet balance on eBills account');
      } else if (errorCode === 'duplicate_request_id') {
        throw new Error('This request ID has already been used');
      } else if (errorCode === 'duplicate_order') {
        throw new Error('Duplicate order detected. Please wait 3 minutes before retrying');
      } else if (errorCode === 'invalid_service') {
        throw new Error('Invalid service ID or phone number does not match network');
      } else if (errorCode === 'below_minimum_amount') {
        throw new Error(`Amount below minimum (₦${minAmount} for ${service_id})`);
      } else if (errorCode === 'above_maximum_amount') {
        throw new Error(`Amount above maximum (₦${maxAmount})`);
      }

      throw new Error(errorMessage);
    }
    throw error;
  }
}

/**
 * Requery order status
 * @param {string} request_id - Request ID of the order
 * @returns {Promise<Object>} Order status
 */
async function requeryOrder(request_id) {
  try {
    const headers = await getHeaders();
    const response = await axios.post(
      `${API_URL}/requery`,
      { request_id },
      { headers }
    );

    return response.data;
  } catch (error) {
    if (error.response) {
      throw new Error(error.response.data?.message || `Error requerying order: ${error.response.status}`);
    }
    throw error;
  }
}

module.exports = {
  getAccessToken,
  checkBalance,
  purchaseAirtime,
  requeryOrder,
};

