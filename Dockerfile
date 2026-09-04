# Use official Node.js LTS slim image
FROM node:20-slim

# Set working directory
WORKDIR /app

# Copy dependency definitions and local dataconnect packages required by npm ci
COPY package*.json ./
COPY src/dataconnect-admin-generated ./src/dataconnect-admin-generated
COPY src/dataconnect-generated ./src/dataconnect-generated

# Install dependencies (cached unless package*.json or dataconnect schemas change)
RUN npm ci

# Copy project source files
COPY . .

# Build frontend production assets (dist/)
RUN npm run build

# Cloud Run defaults to PORT 8080
ENV PORT=8080
ENV NODE_ENV=production

# Expose port
EXPOSE 8080

# Start Express + Vite production server
CMD ["npm", "start"]
