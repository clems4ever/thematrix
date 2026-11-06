FROM node:22-alpine
WORKDIR /app
COPY index.html matrix.js server.js ./
COPY shaders ./shaders
USER node
EXPOSE 8000
CMD ["node", "server.js"]
