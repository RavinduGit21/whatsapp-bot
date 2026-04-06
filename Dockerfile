FROM ghcr.io/puppeteer/puppeteer:latest

USER root

# Install dependencies for better-sqlite3 and other build tools
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (ignoring scripts initially to avoid puppeteer download issues)
RUN npm install

# Copy the rest of the application
COPY . .

# Ensure the database folder exists and is writable
RUN touch orders.db && chmod 666 orders.db

EXPOSE 3000

CMD ["node", "index.js"]
