FROM mcr.microsoft.com/playwright:v1.49.0-jammy

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ENV PORT=5000
ENV PLAYWRIGHT_BROWSERS_PATH=0

EXPOSE 5000

CMD ["npm", "start"]
