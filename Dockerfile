FROM node:22-alpine AS build
WORKDIR /src
COPY . .
RUN node build.js

FROM node:22-alpine
WORKDIR /app
COPY server.js ./
COPY --from=build /src/dist ./
USER node
EXPOSE 8000
CMD ["node", "server.js"]
