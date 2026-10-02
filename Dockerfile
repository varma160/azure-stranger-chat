FROM node:18-alpine

# Set working directory
WORKDIR /usr/src/app

# Copy dependency files first (Docker layer caching)
COPY package*.json ./

# Install only production dependencies cleanly
RUN npm ci --only=production

# Copy application source code
COPY . .

# Run as non-root user for security hardening
USER node

# Expose Azure App Service default port
EXPOSE 8080

# Environment port fallback
ENV PORT=8080

# Start command
CMD ["npm", "start"]

