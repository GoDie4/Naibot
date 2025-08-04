// src/utils/pendingEdits.js
const pendingEdits = new Map(); // chatId → { step: 'awaitingId' | 'awaitingText', rows?, id? }
module.exports = pendingEdits;