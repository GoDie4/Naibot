const { DateTime } = require("luxon");
const { listAllReminders } = require("../services/reminderService");

async function reprogramAll(client) {
  const reminders = await listAllReminders()

  for (const r of reminders) {
    if (r.recurrente && r.recurrencia) {
      cron
        .schedule(
          r.recurrencia,
          async () => {
            await client.sendMessage(r.chatId, {
              text: `⏰ Recordatorio: ${r.mensaje}\n¿Deseas seguir recibiéndolo? (sí/no)`,
            });
            pendingRecurring.set(r.chatId, r.id);
          },
          { timezone: "America/Lima" }
        )
        .start();
    } else if (r.fecha) {
      const dt = DateTime.fromSQL(r.fecha, { zone: "America/Lima" });
      const ms = dt.toMillis() - Date.now();

      if (ms > 0) {
        setTimeout(async () => {
          await client.sendMessage(r.chatId, {
            text: `⏰ Recordatorio: ${r.mensaje}`,
          });
          await deleteReminder(r.id, r.chatId);
        }, ms);
      }
    }
  }

  console.log("✅ Recordatorios reprogramados al iniciar");
}

module.exports = {
  reprogramAll,
};
