// src/services/reminderService.js
const pool = require("../database/connection");
const db = require("../database/connection");

/**
 * Crea un recordatorio único o recurrente
 */
async function createReminder({
  chatId,
  mensaje,
  fecha,
  recurrencia,
  recurrente,
}) {
  const query = `INSERT INTO recordatorios
      (chat_id, mensaje, fecha, recurrencia, recurrente, activo)
      VALUES (?, ?, ?, ?, ?, 1)`;

  const [result] = await db.execute(query, [
    chatId,
    mensaje,
    fecha,
    recurrencia,
    recurrente,
  ]);
  return result.insertId;
}

/**
 * Lista recordatorios activos de un chat
 */
async function listReminders(chatId) {
  let query = `SELECT id, mensaje, fecha, recurrencia, recurrente, chat_id
      FROM recordatorios WHERE activo = 1`;

  const params = [];

  if (chatId !== null) {
    query += ` AND chat_id = ?`;
    params.push(chatId);
  }

  const [rows] = await db.execute(query, params);
  return rows;
}

/**
 * Actualiza campos de un recordatorio (mensaje o fecha/recurrencia)
 */
async function updateReminder(id, chatId, fields) {
  const sets = [];
  const params = [];
  if (fields.mensaje) {
    sets.push("mensaje = ?");
    params.push(fields.mensaje);
  }
  if (fields.fecha !== undefined) {
    sets.push("fecha = ?");
    params.push(fields.fecha);
  }
  if (fields.recurrencia !== undefined) {
    sets.push("recurrencia = ?", "recurrente = 1");
    params.push(fields.recurrencia);
  }
  if (!sets.length) return 0;
  const query = `UPDATE recordatorios SET ${sets.join(
    ", "
  )} WHERE id = ? AND chat_id = ?`;
  params.push(id, chatId);
  const [result] = await db.execute(query, params);
  return result.affectedRows;
}

/**
 * Marca un recordatorio como inactivo (eliminación lógica)
 */
async function deleteReminder(id, chatId) {
  const query = `UPDATE recordatorios SET activo = 0 WHERE id = ? AND chat_id = ?`;
  const [result] = await db.execute(query, [id, chatId]);
  return result.affectedRows;
}

/**
 * Carga recordatorios activos al iniciar el bot
 */
async function loadPending(client, cron) {
  const reminders = await listReminders(null);
  for (const r of reminders) {
    if (r.recurrencia) {
      cron.schedule(r.recurrencia, () => {
        client.sendMessage(r.chat_id, {
          text: `⏰ Recordatorio: ${r.mensaje}`,
        });
      });
    } else if (r.fecha) {
      const date = new Date(r.fecha);
      const ms = date - Date.now();
      if (ms > 0) {
        setTimeout(async () => {
          await client.sendMessage(r.chat_id, {
            text: `⏰ Recordatorio: ${r.mensaje}`,
          });
          await deleteReminder(r.id, r.chat_id);
        }, ms);
      }
    }
  }
}

async function deleteAllReminders(chatId) {
  const query = `UPDATE recordatorios SET activo = 0 WHERE chat_id = ? AND activo = 1`;
  const [result] = await db.execute(query, [chatId]);
  return result.affectedRows; // 👈 devuelve cuántos se desactivaron
}

async function listAllReminders() {
  const [rows] = await pool.query("SELECT * FROM recordatorios");
  return rows;
}
module.exports = {
  createReminder,
  listAllReminders,
  listReminders,
  updateReminder,
  deleteReminder,
  deleteAllReminders,
  loadPending,
};
