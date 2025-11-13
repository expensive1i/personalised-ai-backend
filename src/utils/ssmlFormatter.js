/**
 * SSML Formatter Utility
 * Formats text responses for Google Text-to-Speech using SSML markup
 * Based on Google Cloud TTS SSML documentation
 */

/**
 * Escape SSML reserved characters
 */
function escapeSSML(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Format currency amount (e.g., ₦1000 -> properly spoken currency)
 */
function formatCurrency(amount) {
  if (amount === null || amount === undefined) return '';
  
  const numAmount = typeof amount === 'number' ? amount : parseFloat(String(amount).replace(/,/g, ''));
  if (isNaN(numAmount)) return String(amount);
  
  // Format as Naira currency
  const formatted = `₦${numAmount.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `<say-as interpret-as="currency" language="en-NG">${escapeSSML(formatted)}</say-as>`;
}

/**
 * Format phone number for clear pronunciation
 */
function formatPhoneNumber(phone) {
  if (!phone) return '';
  
  // Remove common formatting characters
  const cleaned = String(phone).replace(/[\s\-\(\)]/g, '');
  
  // Format as telephone number
  return `<say-as interpret-as="telephone" google:style="zero-as-zero">${escapeSSML(cleaned)}</say-as>`;
}

/**
 * Format account number (speak as digits)
 */
function formatAccountNumber(accountNumber) {
  if (!accountNumber) return '';
  
  const cleaned = String(accountNumber).replace(/\D/g, '');
  return `<say-as interpret-as="characters">${escapeSSML(cleaned)}</say-as>`;
}

/**
 * Format number as cardinal (e.g., 10 -> "ten")
 */
function formatCardinal(number) {
  if (number === null || number === undefined) return '';
  
  const num = typeof number === 'number' ? number : parseInt(String(number).replace(/,/g, ''));
  if (isNaN(num)) return String(number);
  
  return `<say-as interpret-as="cardinal">${escapeSSML(String(num))}</say-as>`;
}

/**
 * Format number as ordinal (e.g., 1 -> "first")
 */
function formatOrdinal(number) {
  if (number === null || number === undefined) return '';
  
  const num = typeof number === 'number' ? number : parseInt(String(number).replace(/,/g, ''));
  if (isNaN(num)) return String(number);
  
  return `<say-as interpret-as="ordinal">${escapeSSML(String(num))}</say-as>`;
}

/**
 * Add a pause/break
 */
function addBreak(time = '500ms') {
  return `<break time="${time}"/>`;
}

/**
 * Add emphasis to text
 * If text already contains SSML tags, don't escape them
 */
function addEmphasis(text, level = 'moderate') {
  if (!text) return '';
  const validLevels = ['strong', 'moderate', 'none', 'reduced'];
  const emphasisLevel = validLevels.includes(level) ? level : 'moderate';
  
  // Check if text already contains SSML tags - if so, don't escape
  const hasSSMLTags = /<[^>]+>/.test(text);
  const textToWrap = hasSSMLTags ? text : escapeSSML(text);
  
  return `<emphasis level="${emphasisLevel}">${textToWrap}</emphasis>`;
}

/**
 * Format a sentence with proper SSML structure
 */
function formatSentence(text) {
  if (!text) return '';
  return `<s>${escapeSSML(text)}</s>`;
}

/**
 * Format a paragraph with sentences
 */
function formatParagraph(sentences) {
  if (!sentences || sentences.length === 0) return '';
  const formattedSentences = Array.isArray(sentences) 
    ? sentences.map(s => formatSentence(s)).join(' ')
    : formatSentence(sentences);
  return `<p>${formattedSentences}</p>`;
}

/**
 * Check if text already contains SSML tags
 */
function hasSSML(text) {
  if (!text) return false;
  return /<speak>|<say-as|<break|<emphasis|<prosody|<audio|<p>|<s>/i.test(text);
}

/**
 * Main function to format a complete response with SSML
 * Automatically detects and formats:
 * - Currency amounts (₦1000, ₦1,000.00)
 * - Phone numbers
 * - Account numbers
 * - Numbers
 * - Adds natural pauses
 */
function formatResponse(text, options = {}) {
  if (!text) return '';
  
  const {
    addPauses = true,
    emphasizeImportant = false,
    wrapInSpeak = true,
  } = options;
  
  // If text already contains SSML, only wrap in <speak> if needed
  if (hasSSML(text)) {
    if (wrapInSpeak && !text.includes('<speak>')) {
      return `<speak>${text}</speak>`;
    }
    return text;
  }
  
  let formatted = String(text);
  
  // Format currency amounts (₦ followed by numbers) - but not if already in SSML
  formatted = formatted.replace(
    /₦\s*([\d,]+(?:\.\d{2})?)/g,
    (match, amount, offset) => {
      // Check if this is already inside an SSML tag
      const beforeMatch = formatted.substring(0, offset);
      const openTags = (beforeMatch.match(/<say-as[^>]*>/g) || []).length;
      const closeTags = (beforeMatch.match(/<\/say-as>/g) || []).length;
      if (openTags > closeTags) return match; // Already inside SSML
      return formatCurrency(amount);
    }
  );
  
  // Format phone numbers (Nigerian format: 070..., 080..., 081..., etc.)
  // But avoid formatting if already in SSML
  formatted = formatted.replace(
    /\b(\+?234?\s?[0-7]\d{2}\s?\d{3}\s?\d{4})\b/g,
    (match, phone, offset) => {
      // Check if already inside SSML tag
      const beforeMatch = formatted.substring(0, offset);
      const openTags = (beforeMatch.match(/<say-as[^>]*>/g) || []).length;
      const closeTags = (beforeMatch.match(/<\/say-as>/g) || []).length;
      if (openTags > closeTags) return match; // Already inside SSML
      return formatPhoneNumber(phone);
    }
  );
  
  // Format account numbers in context (e.g., "account ending in 2725", "Account 6718430065")
  formatted = formatted.replace(
    /\b(account\s+(?:ending\s+in\s+|number\s+)?)(\d{4,10})\b/gi,
    (match, prefix, accountNum) => {
      // Check if already in SSML
      if (hasSSML(prefix)) return match;
      return `${prefix}${formatAccountNumber(accountNum)}`;
    }
  );
  
  // Format account numbers that appear after "Account " (for balance responses)
  formatted = formatted.replace(
    /(Account\s+)(\d{10})\b/gi,
    (match, prefix, accountNum) => {
      // Check if already in SSML
      if (hasSSML(prefix)) return match;
      return `${prefix}${formatAccountNumber(accountNum)}`;
    }
  );
  
  // Format short account endings (4 digits) when mentioned as "ending in"
  formatted = formatted.replace(
    /\b(ending\s+in\s+)(\d{4})\b/gi,
    (match, prefix, ending) => {
      if (hasSSML(prefix)) return match;
      return `${prefix}${formatAccountNumber(ending)}`;
    }
  );
  
  // Add pauses after punctuation if enabled (but not inside SSML tags)
  if (addPauses) {
    // Only add breaks if not already inside SSML tags
    formatted = formatted.replace(/([.,;:])\s+/g, (match, punct) => {
      const beforeMatch = formatted.substring(0, formatted.indexOf(match));
      const openTags = (beforeMatch.match(/<[^>]+>/g) || []).length;
      const closeTags = (beforeMatch.match(/<\/[^>]+>/g) || []).length;
      if (openTags > closeTags) return match; // Inside SSML tag
      
      const pauseTime = punct === '.' ? '300ms' : punct === ',' ? '200ms' : punct === ';' ? '250ms' : '200ms';
      return `${punct}${addBreak(pauseTime)} `;
    });
  }
  
  // Wrap important information in emphasis if enabled
  if (emphasizeImportant) {
    // Emphasize currency amounts
    formatted = formatted.replace(
      /(<say-as[^>]*interpret-as="currency"[^>]*>.*?<\/say-as>)/g,
      (match) => {
        // Don't double-emphasize
        if (match.includes('<emphasis')) return match;
        return addEmphasis(match, 'moderate');
      }
    );
  }
  
  // Wrap in <speak> tag if requested and not already wrapped
  if (wrapInSpeak && !formatted.includes('<speak>')) {
    formatted = `<speak>${formatted}</speak>`;
  }
  
  return formatted;
}

/**
 * Format transaction response with SSML
 */
function formatTransactionResponse(transaction) {
  if (!transaction) return '';
  
  const parts = [];
  
  if (transaction.transactionType) {
    parts.push(`a ${transaction.transactionType}`);
  }
  
  if (transaction.amount) {
    parts.push(`of ${formatCurrency(transaction.amount)}`);
  }
  
  if (transaction.receiverName) {
    parts.push(`to ${escapeSSML(transaction.receiverName)}`);
  }
  
  if (transaction.transactionDate) {
    const date = new Date(transaction.transactionDate);
    const dateStr = date.toLocaleDateString('en-NG', { 
      day: 'numeric', 
      month: 'long', 
      year: 'numeric' 
    });
    parts.push(`on ${escapeSSML(dateStr)}`);
  }
  
  if (transaction.status) {
    parts.push(`Status: ${escapeSSML(transaction.status)}`);
  }
  
  return formatResponse(parts.join(' '), { wrapInSpeak: true });
}

/**
 * Format balance response with SSML
 */
function formatBalanceResponse(balance, accountNumber = null) {
  const parts = [];
  
  if (accountNumber) {
    parts.push(`Your account ending in ${formatAccountNumber(String(accountNumber).slice(-4))} has a balance of`);
  } else {
    parts.push('Your account balance is');
  }
  
  parts.push(formatCurrency(balance));
  
  return formatResponse(parts.join(' '), { wrapInSpeak: true });
}

/**
 * Format transfer confirmation with SSML
 */
function formatTransferConfirmation(amount, recipientName, accountEnding = null) {
  const parts = [];
  
  parts.push(`Transfer of ${formatCurrency(amount)}`);
  parts.push(`to ${escapeSSML(recipientName)}`);
  
  if (accountEnding) {
    parts.push(`with account ending ${formatAccountNumber(accountEnding)}`);
  }
  
  parts.push('Please verify your PIN to complete this transaction');
  
  return formatResponse(parts.join(', '), { wrapInSpeak: true });
}

/**
 * Format error message with SSML
 */
function formatErrorMessage(message) {
  return formatResponse(message, { 
    wrapInSpeak: true,
    addPauses: true 
  });
}

/**
 * Format success message with SSML
 */
function formatSuccessMessage(message) {
  return formatResponse(message, { 
    wrapInSpeak: true,
    addPauses: true,
    emphasizeImportant: true 
  });
}

module.exports = {
  formatResponse,
  formatCurrency,
  formatPhoneNumber,
  formatAccountNumber,
  formatCardinal,
  formatOrdinal,
  addBreak,
  addEmphasis,
  formatSentence,
  formatParagraph,
  formatTransactionResponse,
  formatBalanceResponse,
  formatTransferConfirmation,
  formatErrorMessage,
  formatSuccessMessage,
  escapeSSML,
  hasSSML,
};

