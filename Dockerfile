FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json server.js ./
COPY index.html pressure_performance_dashboard.html pressure_performance_methodology.pdf video.html pressure-playbook-linkedin.mp4 ./
COPY data ./data
COPY video/linkedin-cover.jpg ./video/linkedin-cover.jpg

EXPOSE 10000
CMD ["node", "server.js"]

