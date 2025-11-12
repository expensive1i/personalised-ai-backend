/**
 * Recursively converts BigInt and Decimal values for JSON serialization
 * Prisma returns BigInt for certain fields and Decimal for Float fields
 */
function serializeBigInt(obj) {
  if (obj === null || obj === undefined) {
    return obj;
  }

  // Handle BigInt
  if (typeof obj === 'bigint') {
    return obj.toString();
  }

  // Handle Decimal objects (Prisma Decimal type)
  if (obj && typeof obj === 'object') {
    // Check if it's a Decimal object by checking for toString method and Decimal-like structure
    if (obj.constructor && obj.constructor.name === 'Decimal') {
      return Number(obj.toString());
    }
    
    // Handle Decimal-like objects (with s, e, d properties) - Prisma Decimal serialized format
    if ('s' in obj && 'e' in obj && 'd' in obj && Array.isArray(obj.d)) {
      // Reconstruct Decimal from serialized format: s (sign), e (exponent), d (digits)
      try {
        const sign = obj.s === -1 ? -1 : 1;
        const exponent = obj.e;
        const digits = obj.d;
        
        // Convert digits array to number string
        let numStr = digits.join('');
        
        // Adjust for exponent
        if (exponent !== undefined) {
          // This is a simplified conversion - for production, use proper Decimal library
          const num = parseFloat(numStr) * Math.pow(10, exponent - digits.length + 1);
          return sign * num;
        }
        
        return sign * parseFloat(numStr);
      } catch (e) {
        // Fallback: try to convert directly
        return parseFloat(obj.toString ? obj.toString() : String(obj));
      }
    }
  }

  // Handle Date objects
  if (obj instanceof Date) {
    return obj.toISOString();
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(item => serializeBigInt(item));
  }

  // Handle objects
  if (typeof obj === 'object') {
    const serialized = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        serialized[key] = serializeBigInt(obj[key]);
      }
    }
    return serialized;
  }

  // Return primitive values as-is
  return obj;
}

module.exports = {
  serializeBigInt,
};

