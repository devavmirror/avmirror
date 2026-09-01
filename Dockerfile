FROM mcr.microsoft.com/playwright:v1.55.1-noble
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && node -e "const p=require('playwright'); if (!p.chromium.executablePath()) process.exit(1)"

COPY . .
ENV NODE_ENV=production
ENV PORT=7000
ENV BROWSER_HEADLESS=true
EXPOSE 7000
CMD ["npm", "start"]
