// src/index.js
require("dotenv").config();
const {
  default: makeWASocket,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  DisconnectReason,
} = require("@whiskeysockets/baileys");
const QRCode = require("qrcode"); // ← reemplazo
const cron = require("node-cron");
const fs = require("fs");
const { whatsapp } = require("./config");
const routes = require("./routes");
const { loadPending } = require("./services/reminderService");
const { reprogramAll } = require("./controllers/reprogramAll");
const { Boom } = require("@hapi/boom");
const pino = require("pino");

// Logger silencioso compatible con Baileys
const silentLogger = pino({ level: "fatal" });
const dummyLogger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const express = require("express");
const app = express();

let latestQR = ""; // ← aquí se guarda el último QR en base64

app.get("/", (req, res) => res.send("🤖 Bot activo"));
app.get("/qr", (req, res) => {
  if (!latestQR) return res.send("⏳ Aún no hay QR generado");
  res.send(`
    <html>
      <body style="display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column;">
        <h2>Escanea este QR con WhatsApp</h2>
        <img src="${latestQR}" />
      </body>
    </html>
  `);
});

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
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on(
    "connection.update",
    async ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        console.log("📱 Generando QR de conexión...");

        QRCode.toDataURL(qr, function (err, url) {
          if (err) return console.error("❌ Error generando QR", err);
          latestQR = url;
          console.log("✅ Escanea el QR en: http://TU_DOMINIO/qr");
        });
      }

      if (connection === "open") {
        console.log("✅ Bot conectado con Baileys!");

        const testChat = "120363403868512440@g.us"; // cambiar si deseas
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
