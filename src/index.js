// src/index.js
require("dotenv").config();
const {
  default: makeWASocket,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  DisconnectReason,
} = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const cron = require("node-cron");
const fs = require("fs");
const { whatsapp } = require("./config");
const routes = require("./routes");
const { loadPending } = require("./services/reminderService");
const { Boom } = require("@hapi/boom");

const pino = require("pino");

// Logger silencioso compatible con Baileys
const silentLogger = pino({ level: "fatal" }); // solo errores graves

const dummyLogger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const express = require("express");
const { reprogramAll } = require("./controllers/reprogramAll");
const app = express();

app.get("/", (req, res) => res.send("🤖 Bot activo"));
app.listen(3000, () => console.log("🌐 Servidor web activo en el puerto 3000"));

async function connectBot() {
  const clientId = whatsapp.clientId || "default";
  const authFolder = `./baileys_auth_${clientId}`;

  const { state, saveCreds } = await useMultiFileAuthState(authFolder);

  const sock = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, dummyLogger),
    },
    logger: silentLogger,
    // ❌ Eliminado: printQRInTerminal
  });
  // Guardar sesión actualizada
  sock.ev.on("creds.update", saveCreds);

  // Manejo de conexión
  sock.ev.on(
    "connection.update",
    async ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        console.log("📱 Escanea el siguiente QR con tu WhatsApp:");
        qrcode.generate(qr, { small: true });
      }

      if (connection === "open") {
        console.log("✅ Bot conectado con Baileys!");

        // Mensaje de bienvenida
        const testChat = "120363403868512440@g.us"; // cambia si necesitas otro chat
        await sock.sendMessage(testChat, {
          text: "😀 Nailong activo: Hola mi amorcito ❤️",
        });

        await loadPending(sock, cron);

        await reprogramAll(sock);

        routes(sock);
      }

      if (connection === "close") {
        const code = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = code !== DisconnectReason.loggedOut;

        console.log(
          "❌ Bot desconectado:",
          lastDisconnect?.error?.message || "desconocida"
        );

        if (shouldReconnect) {
          console.log("🔁 Reintentando conexión...");
          connectBot();
        } else {
          console.log(
            "🚫 Sesión cerrada. Elimina la carpeta de auth si quieres reconectar."
          );
        }
      }
    }
  );
}

connectBot();
