// src/utils/dateFormatter.js
// Funciones auxiliares para manejo de fechas y horas

/**
 * Formatea una fecha a 12h AM/PM en locale es-PE
 */
function formato12h(date) {
    let hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${hours}:${minutes} ${ampm}`;
  }
  
  /**
   * Ajusta la fecha a la siguiente ocurrencia si no se especifica AM/PM
   */
  function adjustDate(date, timeText) {
    const now = new Date();
    const dt = new Date();
    dt.setHours(date.getHours(), date.getMinutes(), 0, 0);
    if (!/am|pm/i.test(timeText)) {
      if (dt <= now) dt.setHours(dt.getHours() + 12);
      if (dt <= now) dt.setDate(dt.getDate() + 1);
    }
    return dt;
  }
  
  module.exports = { formato12h, adjustDate };