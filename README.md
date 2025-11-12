# Natural Language Banking API

A conversational banking application that allows users to interact with their banking data using natural language. Built with Express.js, Prisma, Google Gemini, and Anthropic Claude.

## Features

- 🤖 **Natural Language Queries**: Ask questions in plain English (or Nigerian Pidgin)
- 💬 **Conversational Interface**: Multi-turn dialogues with context awareness
- 🔍 **Smart Disambiguation**: Handles ambiguous queries (e.g., multiple "Mohammed Sani")
- 📊 **Transaction Queries**: "What's my last transaction?", "How much airtime did I buy from 15-18 June?"
- 💸 **Transfer Requests**: "Transfer ₦5000 to Mohammed Sani"
- ⚡ **Hybrid LLM Approach**: Uses Gemini for fast intent extraction and Claude for complex reasoning

## Prerequisites

- Node.js (v18 or higher)
- PostgreSQL database
- Google Gemini API key
- Anthropic Claude API key

## Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` and add your:
   - Database connection string
   - Gemini API key
   - Anthropic API key

3. **Set up the database:**
   ```bash
   npx prisma generate
   npx prisma migrate dev
   ```

4. **Start the server:**
   ```bash
   npm start
   ```

## API Endpoints

### POST `/api/query-ai` ⭐ **Recommended**
Query AI assistant with natural language. **Automatically authenticates and scopes queries to your account based on phone number.**

**Authentication:** Provide phone number in request body, query parameter, or header (`x-phone-number`)

**Request:**
```json
{
  "phoneNumber": "+2348012345678",
  "message": "what is the last transaction i did?"
}
```

**Alternative ways to authenticate:**
- Query parameter: `POST /api/query-ai?phoneNumber=+2348012345678`
- Header: `x-phone-number: +2348012345678`

**Response:**
```json
{
  "success": true,
  "response": "Your last transaction was a debit of ₦5,000 to John Doe on 12/25/2024. Status: success",
  "action": null,
  "data": null,
  "customer": {
    "id": 1,
    "name": "John Doe",
    "phoneNumber": "+2348012345678"
  }
}
```

### GET `/api-docs`
Swagger API documentation - Interactive API documentation with try-it-out functionality.

### Legacy Endpoints

### POST `/api/chat`
Legacy endpoint (requires customerId in body).

### GET `/api/chat/history/:customerId`
Get conversation history for a customer (legacy).

### DELETE `/api/chat/history/:customerId`
Clear conversation history for a customer (legacy).

## Example Queries

All queries are automatically scoped to your account based on your phone number authentication.

### Transaction Queries
- "What's my last transaction?"
- "Show me my recent transactions"
- "How much airtime did I buy from 15-18 June 2025?"
- "What transactions did I make last week?"
- "Show me all my airtime purchases this month"

### Transfer Requests
- "Transfer ₦5000 to Mohammed Sani"
- "Send 10,000 naira to Chinedu"
- "Pay Ibrahim ₦2000"

### Balance Queries
- "What's my balance?"
- "How much money do I have?"
- "Check my account balance"

### Example cURL Request

```bash
curl -X POST http://localhost:3000/api/query-ai \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "+2348012345678",
    "message": "What is my last transaction?"
  }'
```

### Example JavaScript Fetch

```javascript
const response = await fetch('http://localhost:3000/api/query-ai', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    phoneNumber: '+2348012345678',
    message: 'How much airtime did I buy from 15-18 June 2025?'
  })
});

const data = await response.json();
console.log(data.response);
```

## How It Works

1. **Intent Extraction**: Gemini quickly analyzes the user's message to extract intent and parameters
2. **Smart Routing**: 
   - Simple queries → Direct database execution
   - Complex/ambiguous queries → Claude for reasoning
3. **Disambiguation**: When multiple matches exist (e.g., two "Mohammed Sani"), the system asks clarifying questions
4. **Conversation Management**: Maintains context across multiple turns

## Architecture

```
src/
├── services/
│   ├── database.js          # Prisma database queries
│   ├── llm.js              # Gemini & Claude integration
│   └── conversationManager.js  # Conversation handling
├── routes/
│   └── chat.js             # Express routes
└── app.js                   # Express app setup
```

## Environment Variables

See `.env.example` for required variables:
- `DATABASE_URL`: PostgreSQL connection string
- `GEMINI_API_KEY`: Google Gemini API key
- `ANTHROPIC_API_KEY`: Anthropic Claude API key
- `PORT`: Server port (default: 3000)
- `NODE_ENV`: Environment (development/production)

## Database Schema

The application uses Prisma with the following main models:
- `Customer`: Bank customers
- `Account`: Bank accounts
- `Transaction`: Transaction records
- `Beneficiary`: Saved recipients
- `AccountHistory`: Failed transaction history
- `Document`: RAG documents

See `prisma/schema.prisma` for full schema.

## Notes

- The system handles natural date formats (e.g., "15-18 June 2025")
- Supports Nigerian English and informal language
- Maintains conversation context for multi-turn dialogues
- Uses in-memory conversation storage (consider Redis for production)

## License

ISC

