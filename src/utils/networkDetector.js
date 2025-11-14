/**
 * Network Detection Utility
 * 
 * Detects Nigerian mobile network provider from phone number
 */

/**
 * Network prefixes mapping
 */
const NETWORK_PREFIXES = {
    mtn: [
      '0703', '0706', '0803', '0806', '0810', '0813', '0814', '0816',
      '0903', '0906', '0913',
    ],
    airtel: [
      '0701', '0708', '0802', '0808', '0812',
      '0901', '0902', '0904', '0907', '0912',
    ],
    glo: [
      '0705', '0805', '0807', '0811', '0815',
      '0905', '0915',
    ],
    '9mobile': [
      '0809', '0817', '0818',
      '0908', '0909',
    ],
  };

/**
 * Network names mapping
 */
const NETWORK_NAMES = {
  mtn: 'MTN',
  airtel: 'Airtel',
  glo: 'Glo',
  '9mobile': '9mobile',
};

/**
 * Detect network from phone number
 * @param {string} phone - Phone number (can be in format 08012345678, +2348012345678, etc.)
 * @returns {Object|null} Network info { service_id, name } or null if not detected
 */
function detectNetwork(phone) {
  if (!phone || typeof phone !== 'string') {
    return null;
  }

  // Normalize phone number: remove +234, spaces, and ensure it starts with 0
  let normalizedPhone = phone.replace(/^\+234/, '0').replace(/\s+/g, '').trim();

  // If it doesn't start with 0, add it
  if (!normalizedPhone.startsWith('0')) {
    normalizedPhone = '0' + normalizedPhone;
  }

  // Extract first 4 digits
  const prefix = normalizedPhone.substring(0, 4);

  // Check each network
  for (const [serviceId, prefixes] of Object.entries(NETWORK_PREFIXES)) {
    if (prefixes.includes(prefix)) {
      return {
        service_id: serviceId,
        name: NETWORK_NAMES[serviceId],
      };
    }
  }

  return null;
}

/**
 * Format phone number to standard format (08012345678)
 * Handles various formats including spaces, dashes, parentheses, etc.
 * @param {string} phone - Phone number in any format (e.g., "080 1234 5678", "+234 801 234 5678", "080-123-4567")
 * @returns {string} Normalized phone number (11 digits starting with 0) or null if invalid
 */
function normalizePhone(phone) {
  if (!phone || typeof phone !== 'string') {
    return null;
  }

  // Remove all non-digit characters except + at the start
  // This handles: spaces, dashes, parentheses, dots, etc.
  let cleaned = phone.trim();
  
  // Remove +234 prefix if present
  if (cleaned.startsWith('+234')) {
    cleaned = '0' + cleaned.substring(4);
  } else if (cleaned.startsWith('234')) {
    cleaned = '0' + cleaned.substring(3);
  }
  
  // Remove all non-digit characters (spaces, dashes, parentheses, dots, etc.)
  cleaned = cleaned.replace(/\D/g, '');
  
  // If it starts with 234 (without +), convert to 0
  if (cleaned.startsWith('234') && cleaned.length === 13) {
    cleaned = '0' + cleaned.substring(3);
  }
  
  // Ensure it starts with 0 and is 11 digits
  if (!cleaned.startsWith('0')) {
    cleaned = '0' + cleaned;
  }
  
  // Validate: should be exactly 11 digits starting with 0
  if (cleaned.length === 11 && /^0[0-7]\d{9}$/.test(cleaned)) {
    return cleaned;
  }
  
  // If it's 10 digits, add 0 at the start
  if (cleaned.length === 10 && /^[0-7]\d{9}$/.test(cleaned)) {
    return '0' + cleaned;
  }
  
  return null;
}

/**
 * Normalize account number to standard format (digits only)
 * Handles various formats including spaces, dashes, etc.
 * @param {string} accountNumber - Account number in any format (e.g., "1234 5678 90", "1234-5678-90", "1234567890")
 * @returns {string} Normalized account number (digits only) or null if invalid
 */
function normalizeAccountNumber(accountNumber) {
  if (!accountNumber || typeof accountNumber !== 'string') {
    return null;
  }

  // Remove all non-digit characters (spaces, dashes, dots, etc.)
  let cleaned = accountNumber.trim().replace(/\D/g, '');

  // Nigerian bank account numbers are typically 10 digits
  // Some banks may have different lengths, but 10 is the most common
  // Validate: should be 10 digits
  if (cleaned.length === 10 && /^\d{10}$/.test(cleaned)) {
    return cleaned;
  }

  // Some account numbers might be 9 or 11 digits - accept them if they're all digits
  if ((cleaned.length === 9 || cleaned.length === 11) && /^\d+$/.test(cleaned)) {
    return cleaned;
  }

  return null;
}

module.exports = {
  detectNetwork,
  normalizePhone,
  normalizeAccountNumber,
  NETWORK_NAMES,
};

