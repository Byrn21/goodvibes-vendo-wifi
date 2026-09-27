FROM node:20-alpine

WORKDIR /app

# Install dependencies first (layer caching)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application code
COPY . .

# Expose port (Render proxies external requests to $PORT; defaults to 10000)
ENV PORT=10000
ENV NODE_ENV=production

# Run as non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
USER nodejs

EXPOSE 8080

CMD ["node", "src/server.js"]
