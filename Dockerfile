# ---------- Build stage ----------
FROM node:22-alpine AS builder
# Enable Corepack (included with Node 22) to manage pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Set working directory
WORKDIR /app

# Copy package files first for better layer caching
COPY package.json pnpm-lock.yaml ./

# Install all dependencies using the lockfile
RUN pnpm install --frozen-lockfile

# Copy the rest of the source code
COPY . .

# Build the application
RUN pnpm run build

# ---------- Production stage ----------
FROM node:22-alpine

# Enable Corepack for pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# (Optional) install glibc compatibility if native modules need it
# RUN apk add --no-cache libc6-compat

# Set working directory
WORKDIR /app

# Copy package manifests and install only production dependencies
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# (Optional) Pre-install ask-starknet-mcp globally so npx can find it immediately
# RUN npm install -g @kasarlabs/ask-starknet-mcp && npm cache clean --force

# Copy the compiled build from the builder stage
COPY --from=builder /app/dist ./dist

# Expose application port
EXPOSE 3042
ENV PORT=3042

# Start the application
CMD ["node", "dist/main.js"]
    