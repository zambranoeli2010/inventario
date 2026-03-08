import 'dotenv/config';
import mysql from 'mysql2/promise';

const {
  DB_HOST,
  DB_PORT = 3306,
  DB_USER,
  DB_PASSWORD,
  DB_NAME
} = process.env;

async function main() {
  const conn = await mysql.createConnection({
    host: DB_HOST,
    port: Number(DB_PORT),
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
  });

  try {
    await conn.query('ALTER TABLE users ADD COLUMN username VARCHAR(190) NULL UNIQUE AFTER id');
    console.log('Columna username agregada');
  } catch (err) {
    if (err && err.code === 'ER_DUP_FIELDNAME') {
      console.log('Columna username ya existe, continuando');
    } else {
      throw err;
    }
  }

  await conn.query('UPDATE users SET username = ? WHERE username IS NULL OR username = ""', ['Toque']);
  await conn.query('ALTER TABLE users MODIFY COLUMN username VARCHAR(190) NOT NULL UNIQUE');
  console.log('Username actualizado y marcado NOT NULL UNIQUE');

  await conn.end();
  console.log('Listo');
}

main().catch((err) => {
  console.error('Error corrigiendo schema', err);
  process.exit(1);
});
