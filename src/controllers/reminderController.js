// src/controllers/reminderController.js
// Controladores que procesan mensajes y llaman al servicio

const cron = require("node-cron");
const { DateTime } = require("luxon");
const chrono = require("chrono-node");
const {
  createReminder,
  listReminders,
  updateReminder,
  deleteReminder,
  deleteAllReminders,
} = require("../services/reminderService");

const { formato12h, adjustDate } = require("../utils/dateFormatter");
const pendingConfirmations = require("../utils/pendingConfimation");
const pendingDeletions = require("../utils/pendingDeletions");
const pendingRecurring = require("../utils/pendingRecurring");

const { parseWithAI } = require("../utils/parseWithIA");
const pool = require("../database/connection");

//CREAR

/**
 * handleCreate simplificado:
 * - Si IA devuelve parsed.fecha → recordatorio único en esa fecha exacta.
 * - Else if IA devuelve cron + manualRecurrent → recurrente.
 * - Else error.
 */
async function handleCreate(client, msg, text) {
  const chatId = msg.key.remoteJid;
  const content = text.replace(/^!recordar\s*/i, "").trim();
  console.log("🎯 Texto recibido:", content);

  let parsed;
  try {
    parsed = await parseWithAI(content);
    console.log("🧠 Resultado IA:", parsed);
  } catch (err) {
    console.error("❌ Error al analizar con IA:", err);
    return client.sendMessage(chatId, {
      text: "🚫 No pude entender el recordatorio. Intenta con otra frase.",
    });
  }

  const { texto, fecha, cron: cronExpr } = parsed;
  const manualRecurrent =
    /todos los dias|todos los días|lunes a viernes|de lunes a viernes/i.test(
      content.toLowerCase()
    );

  // ─── RECORDATORIO ÚNICO ───
  if (fecha) {
    // Asegurar que se interpreta en hora Perú
    const dt = DateTime.fromISO(fecha, { zone: "America/Lima" });

    // Convierte a JS Date sin perder la zona horaria (se mantiene como UTC-5 si tu pool MySQL tiene timezone: "-05:00")
    const date = new Date(dt.toISO()); // <- ISO sin shift

    const diff = date.getTime() - Date.now();
    if (diff <= 0) {
      return client.sendMessage(chatId, {
        text: "⚠️ La fecha indicada ya pasó. Por favor elige una fecha futura.",
      });
    }

    const existing = await listReminders(chatId);
    if (
      existing.some(
        (r) =>
          !r.recurrente &&
          new Date(r.fecha).getTime() === date.getTime() &&
          r.mensaje === texto
      )
    ) {
      return client.sendMessage(chatId, {
        text: "⚠️ Ya tienes un recordatorio igual en esa fecha.",
      });
    }

    const insertId = await createReminder({
      chatId,
      mensaje: texto,
      fecha: date,
      recurrencia: null,
      recurrente: 0,
    });

    setTimeout(async () => {
      await client.sendMessage(chatId, { text: `⏰ Recordatorio: ${texto}` });
      await deleteReminder(insertId, chatId);
    }, diff);

    const formatted = dt.setLocale("es").toLocaleString(DateTime.DATETIME_MED);
    return client.sendMessage(chatId, {
      text: `✅ Recordatorio programado para ${formatted}`,
    });
  }

  // ─── RECORDATORIO RECURRENTE ───
  if (cronExpr && manualRecurrent) {
    const existing = await listReminders(chatId);
    if (
      existing.some(
        (r) => r.recurrente && r.mensaje === texto && r.recurrencia === cronExpr
      )
    ) {
      return client.sendMessage(chatId, {
        text: "⚠️ Ya tienes un recordatorio recurrente idéntico.",
      });
    }

    const insertId = await createReminder({
      chatId,
      mensaje: texto,
      fecha: null,
      recurrencia: cronExpr,
      recurrente: 1,
    });

    cron
      .schedule(
        cronExpr,
        async () => {
          await client.sendMessage(chatId, {
            text: `⏰ Recordatorio: ${texto}\n¿Deseas seguir recibiendo este recordatorio? (sí/no)`,
          });
          pendingRecurring.set(chatId, insertId);
        },
        { timezone: "America/Lima" }
      )
      .start();

    return client.sendMessage(chatId, {
      text: `✅ Recordatorio recurrente guardado: ${texto}`,
    });
  }

  return client.sendMessage(chatId, {
    text:
      "⚠️ No pude identificar una fecha o patrón de recurrencia válidos. " +
      "Ejemplo: `!recordar comprar pan el 5 de agosto a las 4pm` o " +
      "`!recordar hidratarte todos los días a las 10am`",
  });
}

//LISTAR
async function handleList(client, msg) {
  const chatId = msg.key.remoteJid;
  const rows = await listReminders(chatId);

  if (!rows.length) {
    return client.sendMessage(chatId, {
      text: "🔍 No tienes recordatorios activos.",
    });
  }

  let reply = "📋 *Tus recordatorios activos:*";

  rows.forEach((r, i) => {
    let when;

    // ─── Recordatorio Recurrente ───
    if (r.recurrencia) {
      const [min, hour, , , dow] = r.recurrencia.split(" ");
      const time = DateTime.fromObject(
        { hour: parseInt(hour, 10), minute: parseInt(min, 10) },
        { zone: "America/Lima", locale: "es" }
      ).toFormat("hh:mm a"); // ej: "10:00 p. m."

      if (dow === "*") {
        when = `Todos los días a las ${time}`;
      } else if (dow === "1-5") {
        when = `De lunes a viernes a las ${time}`;
      } else {
        when = `Recurrente (${r.recurrencia})`;
      }
    }
    // ─── Recordatorio Único ───
    else if (r.fecha) {
      try {
        // Usa fromSQL para formatos "YYYY-MM-DD HH:mm:ss"
        const dt = DateTime.fromSQL(r.fecha, {
          zone: "America/Lima",
          locale: "es",
        });

        const dateStr = dt.toLocaleString(DateTime.DATE_SHORT); // "04/08/2025"
        const timeStr = dt.toFormat("hh:mm a"); // "10:00 PM"
        when = `${dateStr} ${timeStr}`;
      } catch {
        when = "⚠️ Fecha inválida";
      }
    }

    reply += `\n${i + 1}. ${r.mensaje} • ${when}`;
  });

  return client.sendMessage(chatId, { text: reply });
}

async function handleEdit(client, msg, text) {
  const chatId = msg.key.remoteJid;
  const [_, idStr, ...rest] = text.split(/\s+/);
  const id = parseInt(idStr);
  const nuevoTexto = rest.join(" ").trim();

  if (!id || !nuevoTexto) {
    return client.sendMessage(chatId, {
      text: "❌ Usa !editar <id> <nuevo texto con o sin fecha>",
    });
  }

  // Llamamos a la IA para parsear la nueva instrucción
  let parsed;
  try {
    parsed = await parseWithAI(nuevoTexto);
    console.log("🧠 Edit IA:", parsed);
  } catch (err) {
    console.error("❌ Error IA en editar:", err);
    return client.sendMessage(chatId, {
      text: "🚫 No pude entender la nueva fecha/texto. Intenta con otra frase.",
    });
  }

  const { texto, fecha, recurrente, cron: cronExpr } = parsed;
  const fields = { mensaje: texto };

  // Si trae fecha, es un recordatorio único
  if (fecha) {
    const dt = DateTime.fromISO(fecha, { zone: "America/Lima" });
    const dateObj = new Date(dt.toISO());
    fields.fecha = dateObj;
    fields.recurrencia = null;
    fields.recurrente = 0;
  }
  // Si no fecha pero IA marcó recurrente, lo tratamos así
  else if (recurrente && cronExpr) {
    fields.fecha = null;
    fields.recurrencia = cronExpr;
    fields.recurrente = 1;
  }

  // Ejecutamos el update
  const updated = await updateReminder(id, chatId, fields);
  if (!updated) {
    return client.sendMessage(chatId, {
      text: "⚠️ No se encontró o no tienes permiso.",
    });
  }

  // Reprogramar timers
  // 1) Borrar antiguo timeout/cron (si lo tuvieras en memoria) — asumo que no guardas jobs
  // 2) Programar de nuevo según fields
  if (fields.recurrente) {
    // Programar cron recurrente
    cron
      .schedule(
        fields.recurrencia,
        async () => {
          await client.sendMessage(chatId, {
            text: `⏰ Recordatorio: ${texto}\n¿Deseas seguir recibiendo este recordatorio? (sí/no)`,
          });
          pendingRecurring.set(chatId, id);
        },
        { timezone: "America/Lima" }
      )
      .start();
  } else if (fields.fecha) {
    const ms = fields.fecha.getTime() - Date.now();
    if (ms > 0) {
      setTimeout(async () => {
        await client.sendMessage(chatId, { text: `⏰ Recordatorio: ${texto}` });
        await deleteReminder(id, chatId);
      }, ms);
    }
  }

  // Respuesta al usuario
  let infoExtra = texto;
  if (fields.recurrente) {
    infoExtra += ` (recurrente ${fields.recurrencia})`;
  } else if (fields.fecha) {
    const f = DateTime.fromJSDate(fields.fecha, {
      zone: "America/Lima",
      locale: "es",
    });
    const formatted = f.toLocaleString(DateTime.DATETIME_MED);
    infoExtra += ` para ${formatted}`;
  }

  return client.sendMessage(chatId, {
    text: `✏️ Recordatorio #${id} actualizado: ${infoExtra}`,
  });
}

async function handleDelete(client, msg, text) {
  const chatId = msg.key.remoteJid;

  // Parte 1: El usuario solo escribe "!eliminar"
  if (/^!eliminar$/i.test(text.trim())) {
    const rows = await listReminders(chatId);
    if (!rows.length) {
      return client.sendMessage(chatId, {
        text: "🔍 No tienes recordatorios activos.",
      });
    }

    let reply = "📋 *Tus recordatorios activos:*";
    rows.forEach((r) => {
      reply += `\n🆔 ${r.id} — ${r.mensaje}`;
    });

    pendingDeletions.set(chatId, { step: "awaitingId", rows });
    return client.sendMessage(chatId, {
      text: `${reply}\n\n✏️ Envía el *ID* del recordatorio que deseas eliminar:`,
    });
  }

  // Parte 2: Usuario escribe "!eliminar <id>"
  const match = text.trim().match(/^!eliminar\s+(\d+)/i);
  if (match) {
    const id = parseInt(match[1]);
    pendingDeletions.set(chatId, { step: "awaitingConfirm", id });
    return client.sendMessage(chatId, {
      text: `⚠️ ¿Estás seguro de eliminar el recordatorio #${id}?\nResponde con *sí* para confirmar o cualquier otra cosa para cancelar.`,
    });
  }
}

async function handleDeleteFlow(client, msg, text) {
  const chatId = msg.key.remoteJid;
  const state = pendingDeletions.get(chatId);
  const lower = text.trim().toLowerCase();

  if (!state) return;

  // Paso 1: Esperando ID
  if (state.step === "awaitingId") {
    const id = parseInt(text.trim());

    // ID inválido o no está en la lista
    if (isNaN(id) || !state.rows.find((r) => r.id === id)) {
      pendingDeletions.delete(chatId); // 💥 Cancelar el flujo si es inválido
      return client.sendMessage(chatId, {
        text: "❌ ID inválido. El proceso de eliminación fue cancelado.",
      });
    }

    // ID válido
    pendingDeletions.set(chatId, { step: "awaitingConfirm", id });
    return client.sendMessage(chatId, {
      text: `⚠️ ¿Estás seguro de eliminar el recordatorio #${id}?\nResponde con *sí* para confirmar o cualquier otra cosa para cancelar.`,
    });
  }

  // Paso 2: Confirmar
  if (state.step === "awaitingConfirm") {
    pendingDeletions.delete(chatId); // 💥 Siempre se borra el estado en este paso

    if (
      lower === "sí" ||
      lower === "si" ||
      lower === "chi" ||
      lower === "chii"
    ) {
      const deleted = await deleteReminder(state.id, chatId);
      return client.sendMessage(chatId, {
        text: deleted
          ? "🗑️ Recordatorio eliminado correctamente."
          : "⚠️ No se encontró o ya estaba eliminado.",
      });
    } else {
      return client.sendMessage(chatId, {
        text: "❌ Eliminación cancelada.",
      });
    }
  }
}

async function handleDeleteAll(client, msg, text) {
  const chatId = msg.key.remoteJid;

  if (pendingConfirmations.get(chatId)) {
    const lower = text.trim().toLowerCase();
    if (
      lower === "sí" ||
      lower === "si" ||
      lower === "chi" ||
      lower === "chii"
    ) {
      const eliminados = await deleteAllReminders(chatId);
      pendingConfirmations.delete(chatId);
      return client.sendMessage(chatId, {
        text: `🗑️ Se eliminaron ${eliminados} recordatorio(s) correctamente.`,
      });
    } else {
      pendingConfirmations.delete(chatId);
      return client.sendMessage(chatId, {
        text: "❌ Eliminación cancelada.",
      });
    }
  }

  pendingConfirmations.set(chatId, true);
  setTimeout(() => pendingConfirmations.delete(chatId), 60_000);

  return client.sendMessage(chatId, {
    text: "⚠️ ¿Estás seguro que deseas eliminar *todos* tus recordatorios?\nEscribe *sí* para confirmar o cualquier otra cosa para cancelar.",
  });
}


module.exports = {
  handleCreate,
  handleList,
  handleEdit,
  handleDelete,
  handleDeleteAll,
  handleDeleteFlow,
};
