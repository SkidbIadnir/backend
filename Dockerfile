# Use Node.js 20 LTS as the base image
FROM node:20-bookworm

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Install Playwright Firefox (Mozilla) and required OS dependencies
RUN npx playwright install --with-deps firefox

# Copy the rest of the application code
COPY . .

# Build the application
RUN npm run build

# Expose the port
EXPOSE 3000

# Start the application
CMD ["node", "dist/main"]
