# Build stage
FROM node:20-alpine AS builder

# Install pnpm
RUN npm install -g pnpm

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build the application
RUN pnpm run build

# Production stage
FROM node:20-alpine

# Install pnpm and necessary tools for npx
RUN npm install -g pnpm && \
    apk add --no-cache libc6-compat

# Configure npm to use a writable cache directory
RUN mkdir -p /root/.npm && \
    npm config set cache /root/.npm --global

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install only production dependencies
RUN pnpm install --prod --frozen-lockfile

# Pre-install ask-starknet-mcp globally to ensure npx can find it
# This ensures the package is available when npx tries to execute it
RUN npm install -g @kasarlabs/ask-starknet-mcp && \
    npm cache clean --force

# Copy built files from builder stage
COPY --from=builder /app/dist ./dist

# Expose port 3042
EXPOSE 3042

# Set environment variable for port
ENV PORT=3042

# Run the application
CMD ["node", "dist/main.js"]
