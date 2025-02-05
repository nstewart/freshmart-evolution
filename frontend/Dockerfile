FROM node:23.7.0

WORKDIR /usr/src/app

COPY package.json package-lock.json ./
RUN npm install --force && mv node_modules ../

COPY . .

CMD ["npm", "run", "dev"]
