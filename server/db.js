const { Pool, types } = require('pg');

// Sin esto, node-postgres convierte las columnas DATE a objetos Date de JS,
// lo que puede desfasar el día por zona horaria y rompe los <input type="date">
// del navegador (esperan exactamente "YYYY-MM-DD"). OID 1082 = tipo "date".
types.setTypeParser(1082, (val) => val);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err) => {
  console.error('Error inesperado en el pool de PostgreSQL', err);
});

module.exports = { pool };
