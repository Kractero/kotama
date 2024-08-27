FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY app.log ./
RUN npm install

FROM node:22-alpine AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules

COPY . .

RUN apk --no-cache add curl

EXPOSE 3567

ENV PORT 3567

ENV NODE_ENV production

CMD ["npm", "start"]
