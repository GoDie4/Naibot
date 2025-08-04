// src/routes/index.js
const {
  handleCreate,
  handleList,
  handleEdit,
  handleDelete,
  handleDeleteAll,
  handleDeleteFlow,
} = require("../controllers/reminderController");
const {
  listReminders,
  updateReminder,
  deleteReminder,
} = require("../services/reminderService");
const pendingConfirmations = require("../utils/pendingConfimation");
const pendingDeletions = require("../utils/pendingDeletions");
const pendingEdits = require("../utils/pendingEdits");
const pendingRecurring = require("../utils/pendingRecurring");

module.exports = (client) => {
  client.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const sender = msg.key.remoteJid;
    const text =
      msg.message.conversation || msg.message.extendedTextMessage?.text || "";

    // —————— Flujo de DeleteAll ——————
    if (pendingConfirmations.get(sender)) {
      await handleDeleteAll(client, msg, text);
      return;
    }
    if (/^!eliminar-todo$/i.test(text)) {
      await handleDeleteAll(client, msg, text);
      return;
    }

    // —————— Flujo de Edición Multiturno ——————
    const state = pendingEdits.get(sender);

    if (state?.step === "awaitingId") {
      const id = parseInt(text.trim());
      if (!state.rows.find((r) => r.id === id)) {
        return client.sendMessage(sender, {
          text: "❌ ID no válido. Cancela y vuelve a empezar con !editar",
        });
      }
      pendingEdits.set(sender, { step: "awaitingText", id });
      return client.sendMessage(sender, {
        text: `✏️ Has seleccionado el #${id}. Ahora envía el nuevo texto (y opcionalmente fecha):`,
      });
    }

    if (state?.step === "awaitingText") {
      const { id } = state;
      const nuevoTexto = text.trim();

      // Llamamos a handleEdit como si viniera en línea:
      // le pasamos el mensaje "!editar <id> <nuevoTexto>"
      await handleEdit(client, msg, `!editar ${id} ${nuevoTexto}`);

      pendingEdits.delete(sender);
      return;
    }

    // —————— Comando !editar puro (paso 1) ——————
    if (/^!editar$/i.test(text)) {
      const rows = await listReminders(sender);
      if (!rows.length) {
        return client.sendMessage(sender, {
          text: "🔍 No tienes recordatorios activos.",
        });
      }
      let reply = "📋 *Tus recordatorios:*";
      rows.forEach((r) => {
        reply += `\n🆔 ${r.id} — ${r.mensaje}`;
      });
      pendingEdits.set(sender, { step: "awaitingId", rows });
      return client.sendMessage(sender, {
        text: `${reply}\n\n🖋️ Envía el *ID* del recordatorio que quieres editar:`,
      });
    }

    // —————— Comando !editar con ID y texto en una sola línea ——————
    if (/^!editar\s+\d+/i.test(text)) {
      await handleEdit(client, msg, text);
      return;
    }

    // Confirmación eliminación individual
    if (pendingDeletions.get(sender)) {
      await handleDeleteFlow(client, msg, text);
      return;
    }

    // Comandos
    if (/^!eliminar$/i.test(text) || /^!eliminar\s+\d+/i.test(text)) {
      return handleDelete(client, msg, text);
    }

    // —————— Confirmación de recordatorio recurrente ——————
    const pendingId = pendingRecurring.get(sender);
    if (pendingId) {
      pendingRecurring.delete(sender);

      if (
        text === "no" ||
        text === "n" ||
        text === "ño" ||
        text === "ñoo" ||
        text === "No" ||
        text === "NO" ||
        text === "Nop" ||
        text === "nop"
      ) {
        // Desactivar el recordatorio
        await deleteReminder(pendingId, sender);
        return client.sendMessage(sender, {
          text: `❌ El recordatorio #${pendingId} ha sido desactivado.`,
        });
      } else {
        // Usuario confirma mantenerlo
        return client.sendMessage(sender, {
          text: "✅ Perfecto, seguirás recibiendo este recordatorio.",
        });
      }
    }

    // —————— Resto de comandos ——————
    if (/^!ping$/i.test(text)) {
      return client.sendMessage(sender, { text: "¡Pong! 🏓" });
    } else if (/^!recordar\s+/i.test(text)) {
      return handleCreate(client, msg, text);
    } else if (/^!listar$/i.test(text)) {
      return handleList(client, msg);
    }
  });
};
