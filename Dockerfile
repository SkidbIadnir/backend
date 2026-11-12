# Use Node.js 20 LTS as the base image
FROM node:20-bookworm

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Build the application
RUN npm run build

# Tasting photos. Mount a persistent volume here (see README "Docker / CI"),
# otherwise uploads are lost when the container is replaced.
ENV TASTEEP_PHOTOS_DIR=/data/photos
RUN mkdir -p /data/photos

# Expose the port
EXPOSE 3000

# Start the application
CMD ["node", "dist/main"]
