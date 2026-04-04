FROM node:20-alpine

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package*.json ./
RUN npm install --production

# Copy source
COPY . .

EXPOSE 3001

CMD ["node", "server.js"]
