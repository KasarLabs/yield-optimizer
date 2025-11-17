# Yield Optimizer API

NestJS TypeScript backend API with AI-powered yield optimization for Starknet.

## Description

A [NestJS](https://github.com/nestjs/nest) backend API that uses Gemini AI and the Model Context Protocol (MCP) to find optimal yield paths on Starknet. The API analyzes DeFi protocols to identify the best APY opportunities and calculates optimal token swap routes.

## Installation

```bash
pnpm install
```

## Configuration

Create a `.env` file in the root directory with the following variables:

```bash
# Starknet Configuration
STARKNET_RPC_URL=https://starknet-mainnet.public.blastapi.io

# LLM Configuration (Anthropic Claude)
ANTHROPIC_API_KEY=your-anthropic-api-key-here
# OR
MODEL_API_KEY=your-model-api-key-here

# Application Configuration
PORT=3042

# Security Configuration
API_SECRET=your-api-secret-key-here
CORS_ORIGIN=http://localhost:3000,https://yourdomain.com

# LangSmith Monitoring (Optional)
# Enable LangSmith tracking for monitoring LLM calls, costs, and performance
LANGSMITH_ENABLED=true
LANGSMITH_API_KEY=your-langsmith-api-key-here
LANGSMITH_PROJECT=yield-optimizer
# Alternative: Use LANGCHAIN_* variables
# LANGCHAIN_TRACING_V2=true
# LANGCHAIN_API_KEY=your-langsmith-api-key-here
# LANGCHAIN_PROJECT=yield-optimizer
```

You can use `.env.example` as a template.

### LangSmith Integration

LangSmith is integrated to track and monitor all LLM calls made through the Anthropic SDK. When enabled, you can:

- **Monitor LLM Usage**: See all API calls to Claude
- **Track Costs**: Monitor token usage and associated costs
- **Debug Issues**: View detailed request/response logs
- **Performance Metrics**: Analyze latency and throughput

To enable LangSmith:

1. Get your API key from [LangSmith](https://smith.langchain.com/)
2. Set `LANGSMITH_ENABLED=true` in your `.env` file
3. Set `LANGSMITH_API_KEY` with your LangSmith API key
4. Optionally set `LANGSMITH_PROJECT` to organize your traces (defaults to `yield-optimizer`)

The integration automatically tracks all LLM calls made during yield path discovery. Visit your LangSmith dashboard to view traces, costs, and performance metrics.

## Running the app

```bash
# development
pnpm run start:dev

# production mode
pnpm run start:prod
```

## Test

```bash
# unit tests
pnpm run test

# e2e tests
pnpm run test:e2e

# test coverage
pnpm run test:cov
```

## API Endpoints

### Health Check

- **GET** `/health` - Check API health status

### Yield Optimization

- **POST** `/get_path` - Find optimal yield path for a token
  - **Headers**: 
    - `X-API-Secret`: Your API secret key (required)
    - OR `Authorization: Bearer <your-api-secret>`
  - **Body**: `{ "address": "0x...", "amount": "1000000" }` - Starknet token address and amount
  - **Response**: Returns the best APY opportunity and optimal swap route

Example request:

```bash
curl -X POST http://localhost:3042/get_path \
  -H "Content-Type: application/json" \
  -H "X-API-Secret: your-api-secret-key-here" \
  -d '{"address": "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7", "amount": "1000000"}'
```

## Security Features

The API includes several security measures:

- **Helmet**: Security headers to protect against common vulnerabilities
- **Rate Limiting**: 
  - General: 100 requests per 15 minutes per IP
  - `/get_path` endpoint: 20 requests per minute per IP
- **API Secret Authentication**: All `/get_path` requests require a valid API secret via `X-API-Secret` header or `Authorization: Bearer <secret>`
- **CORS**: Configurable CORS origins (set `CORS_ORIGIN` in `.env`)
- **Body Size Limit**: 1MB maximum request body size
- **Input Validation**: Automatic validation and sanitization of request data

## Project Structure

```
src/
├── main.ts                      # Application entry point
├── modules/
│   └── app.module.ts            # Root module with ConfigModule and ThrottlerModule
├── controllers/
│   └── app.controller.ts        # API endpoints
├── guards/
│   └── api-secret.guard.ts      # API secret authentication guard
└── services/
    ├── app.service.ts           # Business logic orchestration
    └── mcp-agent.service.ts     # Gemini AI + MCP integration
```

## How It Works

1. **Token Validation**: Validates the Starknet token address format
2. **MCP Connection**: Establishes connection to ask-starknet MCP server
3. **AI Analysis**: Gemini AI agent queries Starknet protocols via MCP tools
4. **Yield Discovery**: Identifies protocols with the best APY
5. **Route Optimization**: Calculates optimal swap path to target token
6. **Results**: Returns comprehensive analysis with APY data and swap routes

## License

[MIT licensed](LICENSE).
