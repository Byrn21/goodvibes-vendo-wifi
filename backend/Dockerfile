FROM node:22-alpine

WORKDIR /app

# Install dependencies first (layer caching)
# --omit=dev skips jest, nodemon, supertest
# better-sqlite3 needs native build tools but is only used for local dev
RUN apk add --no-cache python3 make g++

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

# Run migrations before starting the server
CMD ["sh", "-c", "node src/db/migrate.js && node src/server.js"]
