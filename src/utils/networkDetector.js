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
 * @param {string} phone - Phone number in any format
 * @returns {string} Normalized phone number
 */
function normalizePhone(phone) {
  if (!phone || typeof phone !== 'string') {
    return null;
  }

  // Remove +234, spaces, and ensure it starts with 0
  let normalized = phone.replace(/^\+234/, '0').replace(/\s+/g, '').trim();

  if (!normalized.startsWith('0')) {
    normalized = '0' + normalized;
  }

  return normalized;
}

module.exports = {
  detectNetwork,
  normalizePhone,
  NETWORK_NAMES,
};

