FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json server.js ./
COPY index.html pressure_performance_dashboard.html pressure_performance_methodology.pdf ./
COPY data ./data

EXPOSE 10000
CMD ["node", "server.js"]
