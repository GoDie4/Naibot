// src/database/connection.js
// Configuración de pool MySQL con mysql2/promise
const mysql = require("mysql2/promise");
const { db: dbConfig } = require("../config");

const pool = mysql.createPool(dbConfig);
module.exports = pool;
