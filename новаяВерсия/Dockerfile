# Stage 1: build stage
FROM node:20-bullseye AS builder

WORKDIR /app

# Backend deps
COPY backend/package*.json backend/
RUN npm install --prefix backend

# Frontend deps
COPY frontend/package*.json frontend/
RUN npm install --prefix frontend

# Copy sources
COPY backend backend
COPY frontend frontend

# Build frontend and backend
RUN npm run build --prefix frontend
RUN npm run build --prefix backend

# Stage 2: runtime stage
FROM node:20-bullseye AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8443

COPY backend/package*.json ./
RUN npm install --omit=dev

COPY --from=builder /app/backend/dist ./dist
COPY --from=builder /app/frontend/dist ./public
COPY --from=builder /app/backend/ssl ./ssl

VOLUME ["/app/data"]
EXPOSE 8443

CMD ["node", "dist/src/server.js"]

    
    
