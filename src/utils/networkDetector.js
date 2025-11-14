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
 * Also handles voice-to-text transcription errors (e.g., "oh" for "0", "one" for "1")
 * @param {string} phone - Phone number in any format (e.g., "080 1234 5678", "+234 801 234 5678", "080-123-4567", "oh eight oh one two three four five six seven eight")
 * @returns {string} Normalized phone number (11 digits starting with 0) or null if invalid
 */
function normalizePhone(phone) {
  if (!phone || typeof phone !== 'string') {
    return null;
  }

  // Step 1: Convert to lowercase for easier processing
  let cleaned = phone.trim().toLowerCase();
  
  // Step 2: Handle common voice-to-text errors - replace word numbers with digits
  // This handles cases like "oh eight oh" instead of "080"
  const wordToDigit = {
    'zero': '0', 'oh': '0', 'o': '0',
    'one': '1', 'won': '1',
    'two': '2', 'to': '2', 'too': '2',
    'three': '3', 'tree': '3',
    'four': '4', 'for': '4', 'fore': '4',
    'five': '5', 'fife': '5',
    'six': '6', 'sicks': '6',
    'seven': '7', 'sevin': '7',
    'eight': '8', 'ate': '8',
    'nine': '9', 'nein': '9',
  };
  
  // Replace word numbers with digits (handle both standalone and in context)
  for (const [word, digit] of Object.entries(wordToDigit)) {
    // Match whole words only (with word boundaries)
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    cleaned = cleaned.replace(regex, digit);
  }
  
  // Step 3: Remove common voice-to-text artifacts and symbols
  // Remove common punctuation and symbols that might appear in voice transcription
  cleaned = cleaned
    .replace(/[^\d\+\s\-\(\)\.]/g, '') // Remove all except digits, +, spaces, dashes, parentheses, dots
    .replace(/\s+/g, '') // Remove all spaces
    .replace(/[\(\)\.]/g, ''); // Remove parentheses and dots
  
  // Step 4: Handle country code prefixes
  // Remove +234 prefix if present (with or without spaces)
  if (cleaned.startsWith('+234')) {
    cleaned = '0' + cleaned.substring(4).replace(/\D/g, '');
  } else if (cleaned.startsWith('234')) {
    // Handle 234 without + (might have spaces or other chars)
    cleaned = cleaned.replace(/^234/, '0');
  }
  
  // Step 5: Remove all remaining non-digit characters
  cleaned = cleaned.replace(/\D/g, '');
  
  // Step 6: Handle 234 prefix if it appears after cleaning (13 digits total)
  if (cleaned.startsWith('234') && cleaned.length === 13) {
    cleaned = '0' + cleaned.substring(3);
  }
  
  // Step 7: Ensure it starts with 0
  if (!cleaned.startsWith('0') && cleaned.length > 0) {
    // If it doesn't start with 0, check if it's a valid 10-digit number
    if (cleaned.length === 10 && /^[0-7]\d{9}$/.test(cleaned)) {
      cleaned = '0' + cleaned;
    } else if (cleaned.length === 9 && /^[0-7]\d{8}$/.test(cleaned)) {
      cleaned = '0' + cleaned;
    } else if (cleaned.length >= 10) {
      // If it's longer, try to extract the last 10 digits and add 0
      const last10 = cleaned.slice(-10);
      if (/^[0-7]\d{9}$/.test(last10)) {
        cleaned = '0' + last10;
      } else {
        cleaned = '0' + cleaned;
      }
    } else {
      cleaned = '0' + cleaned;
    }
  }
  
  // Step 8: Validate and return
  // Nigerian phone numbers should be 11 digits starting with 0
  // First digit after 0 should be 0-7 (network codes)
  if (cleaned.length === 11 && /^0[0-7]\d{9}$/.test(cleaned)) {
    return cleaned;
  }
  
  // If it's 10 digits and valid, add 0 at the start
  if (cleaned.length === 10 && /^[0-7]\d{9}$/.test(cleaned)) {
    return '0' + cleaned;
  }
  
  // If it's 12 digits, might have an extra leading digit - try removing first digit
  if (cleaned.length === 12 && cleaned.startsWith('0')) {
    const withoutFirst = cleaned.substring(1);
    if (/^0[0-7]\d{9}$/.test(withoutFirst)) {
      return withoutFirst;
    }
  }
  
  // Last resort: if we have 11 digits but doesn't match pattern, still return if it starts with 0
  // This is more forgiving for edge cases from voice transcription
  if (cleaned.length === 11 && cleaned.startsWith('0') && /^\d{11}$/.test(cleaned)) {
    // Check if second digit is 0-7 (network code)
    const secondDigit = parseInt(cleaned[1]);
    if (secondDigit >= 0 && secondDigit <= 7) {
      return cleaned;
    }
  }
  
  return null;
}

/**
 * Normalize account number to standard format (digits only)
 * Handles various formats including spaces, dashes, etc.
 * Also handles voice-to-text transcription errors (e.g., "one" for "1", "two" for "2")
 * @param {string} accountNumber - Account number in any format (e.g., "1234 5678 90", "1234-5678-90", "1234567890", "one two three four five six seven eight nine zero")
 * @returns {string} Normalized account number (digits only) or null if invalid
 */
function normalizeAccountNumber(accountNumber) {
  if (!accountNumber || typeof accountNumber !== 'string') {
    return null;
  }

  // Step 1: Convert to lowercase for easier processing
  let cleaned = accountNumber.trim().toLowerCase();
  
  // Step 2: Handle common voice-to-text errors - replace word numbers with digits
  // This handles cases like "one two three" instead of "123"
  const wordToDigit = {
    'zero': '0', 'oh': '0', 'o': '0',
    'one': '1', 'won': '1',
    'two': '2', 'to': '2', 'too': '2',
    'three': '3', 'tree': '3',
    'four': '4', 'for': '4', 'fore': '4',
    'five': '5', 'fife': '5',
    'six': '6', 'sicks': '6',
    'seven': '7', 'sevin': '7',
    'eight': '8', 'ate': '8',
    'nine': '9', 'nein': '9',
  };
  
  // Replace word numbers with digits (handle both standalone and in context)
  for (const [word, digit] of Object.entries(wordToDigit)) {
    // Match whole words only (with word boundaries)
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    cleaned = cleaned.replace(regex, digit);
  }
  
  // Step 3: Remove common voice-to-text artifacts and symbols
  // Remove common punctuation and symbols that might appear in voice transcription
  cleaned = cleaned
    .replace(/[^\d\s\-\(\)\.]/g, '') // Remove all except digits, spaces, dashes, parentheses, dots
    .replace(/\s+/g, '') // Remove all spaces
    .replace(/[\(\)\.]/g, ''); // Remove parentheses and dots
  
  // Step 4: Remove all remaining non-digit characters (dashes, etc.)
  cleaned = cleaned.replace(/\D/g, '');
  
  // Step 5: Validate and return
  // Nigerian bank account numbers are typically 10 digits
  // Some banks may have different lengths, but 10 is the most common
  if (cleaned.length === 10 && /^\d{10}$/.test(cleaned)) {
    return cleaned;
  }
  
  // Some account numbers might be 9 or 11 digits - accept them if they're all digits
  if ((cleaned.length === 9 || cleaned.length === 11) && /^\d+$/.test(cleaned)) {
    return cleaned;
  }
  
  // If it's 8 digits, might be missing leading zero - try adding it
  if (cleaned.length === 8 && /^\d{8}$/.test(cleaned)) {
    return '0' + cleaned;
  }
  
  // If it's 12 digits, might have an extra leading digit - try removing first digit
  if (cleaned.length === 12 && /^\d{12}$/.test(cleaned)) {
    const withoutFirst = cleaned.substring(1);
    if (/^\d{10}$/.test(withoutFirst)) {
      return withoutFirst;
    }
  }
  
  // Last resort: if we have 10 digits but doesn't match strict pattern, still return if all digits
  // This is more forgiving for edge cases from voice transcription
  if (cleaned.length === 10 && /^\d{10}$/.test(cleaned)) {
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

