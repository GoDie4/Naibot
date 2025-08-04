// src/config.js
// Centraliza configuración y variables de entorno
require("dotenv").config();

module.exports = {
  db: {
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASS || "",
    database: process.env.DB_NAME || "naibot",
    port: process.env.DB_PORT || 3308,
    waitForConnections: true,
    connectionLimit: 5,
    timezone: "-05:00",
    dateStrings: true 
  },
  whatsapp: {
    clientId: process.env.CLIENT_ID || "whatsapp-bot",
  },
};
