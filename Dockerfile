# Image de base légère avec une version de Node figée
FROM node:20-alpine

# Répertoire de travail dans le conteneur
WORKDIR /app

# On copie d'abord les manifestes pour profiter du cache de layers Docker
COPY package*.json ./

# Installation des dépendances de production uniquement
RUN npm ci --omit=dev

# Copie du reste du code applicatif
COPY . .

# Port exposé par l'application Express
EXPOSE 3000

# Démarrage de l'application (forme exec)
CMD ["node", "app/server.js"]
