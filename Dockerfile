FROM node:22-alpine
WORKDIR /app
COPY index.html matrix.js server.js ./
USER node
EXPOSE 8000
CMD ["node", "server.js"]
