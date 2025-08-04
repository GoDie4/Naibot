require("dotenv").config({
  path: require("path").resolve(__dirname, "../../.env"),
});
const { OpenAI } = require("openai");

console.log("📁 Working directory:", process.cwd());
console.log("📄 .env exists:", require("fs").existsSync(".env"));
console.log(
  "🔐 API Key from env:",
  process.env.OPENAI_API_KEY?.slice(0, 10) + "..."
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Analiza un mensaje natural y devuelve un objeto con:
 * - texto
 * - fecha (en ISO string)
 * - recurrente: true/false
 * - cron: null o expresión cron
 */
async function parseWithAI(input) {
  const prompt = `
    Eres un asistente que convierte comandos de recordatorio en español a un JSON con estos campos:
    - texto: string (lo que hay que recordar).
    - fecha: ISO 8601 con zona -05:00 (América/Lima).
        • Si el usuario menciona día de la semana (lunes, martes, ... ) sin número de día, usa la próxima fecha que corresponda a ese día.
        • Si solo menciona hora sin "AM"/"PM", asume PM.
        • Si solo hay hora (y no día ni fecha), fecha = fecha actual (2025-08-02).
    - hora12: hora en formato de 12 horas "hh:mm AM/PM".
    - recurrente: booleano.
    - cron: expresión cron de 5 campos "MM HH * * DOW" si es recurrente, o null.
    
    La fecha actual es 2025-08-02 (América/Lima).
    
    Ejemplo de salida:
    {
      "texto": "revisar correo",
      "fecha": "2025-08-04T09:00:00-05:00",
      "hora12": "09:00 AM",
      "recurrente": false,
      "cron": null
    }
    
    — Si el comando fuera “revisar correo lunes a las 9”, devolverías fecha = próximo lunes 4 de agosto a las 09:00 AM.  
    — Si el comando fuera “tomar agua todos los días a las 8am”, recurrente = true y cron = “00 08 * * *”.  
    
    Ahora analiza este comando y devuelve **solo** el JSON válido:
    "${input}"
    `;

  const res = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.0,
  });

  return JSON.parse(res.choices[0].message.content.trim());
}

module.exports = { parseWithAI };
