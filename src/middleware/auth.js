const { getCustomerByPhone } = require('../services/database');
const { normalizePhone } = require('../utils/networkDetector');

/**
 * Authentication middleware - validates customer by phone number
 * Supports phone number in:
 * - Request body (POST/PUT/PATCH)
 * - Query parameter (GET/DELETE)
 * - Header x-phone-number (all methods)
 */
async function authenticateByPhone(req, res, next) {
  try {
    // Try to get phone number from multiple sources
    const phoneNumber = 
      req.body?.phoneNumber || 
      req.headers['x-phone-number'] || 
      req.query?.phoneNumber;

    if (!phoneNumber) {
      return res.status(401).json({
        success: false,
        error: 'Phone number is required for authentication',
        message: 'Please provide your phone number in one of the following ways:\n' +
                 '1. Request body: { "phoneNumber": "+2348012345678" }\n' +
                 '2. Query parameter: ?phoneNumber=+2348012345678\n' +
                 '3. Header: x-phone-number: +2348012345678',
      });
    }

    // Normalize phone number using enhanced normalization (handles voice-to-text errors, symbols, etc.)
    const normalizedPhone = normalizePhone(phoneNumber.toString()) || phoneNumber.toString().trim().replace(/\s+/g, '');

    // Get customer by phone number
    const customer = await getCustomerByPhone(normalizedPhone);

    if (!customer) {
      // Show both formats in error message for clarity
      const originalFormat = phoneNumber.toString().trim();
      const formatInfo = originalFormat !== normalizedPhone ? 
        ` (normalized from ${originalFormat} to ${normalizedPhone})` : '';
      
      return res.status(404).json({
        success: false,
        error: 'Customer not found',
        message: `No customer found with phone number: ${normalizedPhone}${formatInfo}. Please ensure you are registered. You can use either +2347016409616 or 07016409616 format.`,
      });
    }

    // Attach customer to request object
    req.customer = customer;
    req.customerId = customer.id;

    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({
      success: false,
      error: 'Authentication failed',
      message: error.message,
    });
  }
}

module.exports = {
  authenticateByPhone,
};

