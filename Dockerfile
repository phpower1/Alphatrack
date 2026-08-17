# Use official Node.js LTS image
FROM node:20-slim

# Set working directory
WORKDIR /app

# Copy dependency definitions
COPY package*.json ./

# Install dependencies (including tsx and build tools)
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
