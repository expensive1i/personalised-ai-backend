const { GoogleGenerativeAI } = require('@google/generative-ai');
const Anthropic = require('@anthropic-ai/sdk');

// Initialize LLM clients
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const geminiModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
const claudeModel = 'claude-sonnet-4-20250514';

/**
 * Nigerian Banking Context
 */
const BANKING_CONTEXT = `
Nigerian Banking Context:
- Currency: Naira (₦)
- Common transactions: airtime, data, transfers, bills
- Users may use informal language, pidgin, or code-switching
- Date formats: DD/MM/YYYY, natural language like "last week", "15-18 June 2025"
- Common names often have multiple matches (Mohammed, Ibrahim, Chinedu, etc.)
- Transaction types: debit, credit, airtime, transfer, bill payment
`;

/**
 * Extract intent and parameters using Gemini (fast, good for varied formats)
 */
async function extractIntentWithGemini(userMessage, conversationHistory = []) {
  const currentDate = new Date().toISOString().split('T')[0];

  const prompt = `${BANKING_CONTEXT}

Current Date: ${currentDate}

Conversation History:
${JSON.stringify(conversationHistory.slice(-5), null, 2)}

User Message: "${userMessage}"

Analyze this message and extract:
1. Intent (query_transaction, query_bill_payment, make_transfer, buy_airtime, check_balance, get_last_transaction, general_question, unclear)
2. Parameters (dates, amounts, names, transaction types, payment types)
3. Confidence (0-1)
4. Whether clarification is needed
5. Is this a banking-related question? (true/false)

IMPORTANT: If the question is about airtime, data, cable, internet, or electricity, use intent "query_bill_payment" and set transactionType to the specific type (airtime, data, cable, internet, electricity).

Respond ONLY in valid JSON format:
{
    "intent": "query_transaction|query_bill_payment|make_transfer|check_balance|get_last_transaction|general_question|unclear",
    "parameters": {
        "startDate": "YYYY-MM-DD or null",
        "endDate": "YYYY-MM-DD or null",
        "transactionType": "airtime|data|cable|internet|electricity|transfer|all|null",
        "amount": number or null,
        "recipientName": "string or null",
        "accountId": number or null
    },
    "confidence": 0.0-1.0,
    "requiresClarification": true|false,
    "isBankingRelated": true|false,
    "reasoning": "brief explanation"
}`;

  try {
    const result = await geminiModel.generateContent(prompt);
    const response = result.response.text();
    
    // Clean JSON response (remove markdown if present)
    const cleanedResponse = response
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .trim();

    const parsed = JSON.parse(cleanedResponse);
    return parsed;
  } catch (error) {
    console.error('Error extracting intent with Gemini:', error);
    return {
      intent: 'unclear',
      parameters: {},
      confidence: 0.3,
      requiresClarification: true,
      reasoning: 'Failed to parse user intent',
    };
  }
}

/**
 * Process complex queries with Claude (better for reasoning and disambiguation)
 */
async function processWithClaude(userMessage, conversationHistory = [], tools = []) {
  const currentDate = new Date().toISOString().split('T')[0];

  const systemPrompt = `${BANKING_CONTEXT}

You are a helpful Nigerian banking assistant. You can:
1. Understand informal language, pidgin, and varied date formats
2. Ask clarifying questions naturally when there are multiple matches
3. Be conversational and friendly
4. Handle ambiguity gracefully
5. Extract dates from natural language (e.g., "15-18 June 2025" = 2025-06-15 to 2025-06-18)
6. Answer general questions about banking, finance, and your services
7. If a question is not related to banking or you don't have the information, politely explain that you're a banking assistant and can help with account-related queries

Current date: ${currentDate}

IMPORTANT GUIDELINES:
- For ANY banking-related question, use the available tools to get accurate information from the database
- For questions about transactions, balances, transfers, beneficiaries - ALWAYS use tools
- For questions about airtime, data, cable, internet, electricity - ALWAYS use search_bill_payments tool (NOT search_transactions)
- For general banking questions (how to open account, interest rates, etc.) - answer conversationally
- For non-banking questions - politely redirect to banking topics
- Always be helpful, friendly, and conversational
- When you use tools, wait for the results before responding
- Format amounts in Naira (₦) with proper formatting
- Use natural language in your responses`;

  try {
    const messages = conversationHistory.length > 0 
      ? conversationHistory.map(msg => ({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content,
        }))
      : [];
    
    // Only add user message if it's not empty (empty means we're sending tool results)
    if (userMessage) {
      messages.push({ role: 'user', content: userMessage });
    }

    const response = await anthropic.messages.create({
      model: claudeModel,
      max_tokens: 2048,
      system: systemPrompt,
      tools: tools.length > 0 ? tools : undefined,
      messages,
    });

    return response;
  } catch (error) {
    console.error('Error processing with Claude:', error);
    throw error;
  }
}

/**
 * Format date from natural language
 */
function parseNaturalDate(dateString, isEndDate = false) {
  if (!dateString) return null;

  const today = new Date();
  const dateStr = dateString.toLowerCase().trim();

  // Handle "15-18 June 2025" format
  if (dateStr.includes('-')) {
    const parts = dateStr.split('-');
    if (parts.length === 2) {
      const firstPart = parts[0].trim();
      const secondPart = parts[1].trim();
      
      // Extract day, month, year
      const dayMatch = firstPart.match(/(\d+)/);
      const monthYearMatch = secondPart.match(/(\w+)\s*(\d+)?/);
      
      if (dayMatch && monthYearMatch) {
        const day = parseInt(dayMatch[1]);
        const monthName = monthYearMatch[1];
        const year = monthYearMatch[2] ? parseInt(monthYearMatch[2]) : today.getFullYear();
        
        const monthMap = {
          january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
          july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
          jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
        };
        
        const month = monthMap[monthName.toLowerCase()];
        if (month !== undefined) {
          if (isEndDate) {
            // For end date, use the second day
            const secondDayMatch = secondPart.match(/(\d+)/);
            const endDay = secondDayMatch ? parseInt(secondDayMatch[1]) : day;
            return new Date(year, month, endDay).toISOString().split('T')[0];
          } else {
            return new Date(year, month, day).toISOString().split('T')[0];
          }
        }
      }
    }
  }

  // Handle other formats (simplified - you may want to use a library like chrono-node)
  try {
    const date = new Date(dateString);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  } catch (e) {
    // Fallback
  }

  return null;
}

module.exports = {
  extractIntentWithGemini,
  processWithClaude,
  parseNaturalDate,
  geminiModel,
};

