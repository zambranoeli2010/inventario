import 'dotenv/config';
import mysql from 'mysql2/promise';
import bcrypt from 'bcrypt';

const {
  DB_HOST,
  DB_PORT = 3306,
  DB_USER,
  DB_PASSWORD,
  DB_NAME
} = process.env;

if (!DB_HOST || !DB_USER || !DB_PASSWORD || !DB_NAME) {
  console.error('Faltan variables de entorno. Revisa .env');
  process.exit(1);
}

async function main() {
  const username = 'Toque';
  const email = 'admin@toquedivino.com';
  const plainPassword = 'divino2712';
  const question = 'Color favorito de la marca';
  const answer = 'turquesa';

  const passwordHash = await bcrypt.hash(plainPassword, 10);
  const answerHash = await bcrypt.hash(answer.toLowerCase().trim(), 10);

  const pool = mysql.createPool({
    host: DB_HOST,
    port: Number(DB_PORT),
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME
  });

  const insertSql = `INSERT INTO users (username, email, password_hash, visible_password, security_question, security_answer_hash)
    VALUES (?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      password_hash = VALUES(password_hash),
      visible_password = VALUES(visible_password),
      security_question = VALUES(security_question),
      security_answer_hash = VALUES(security_answer_hash),
      email = VALUES(email)`;

  await pool.query(insertSql, [username, email, passwordHash, plainPassword, question, answerHash]);
  await pool.end();

  console.log('Seed listo. Usuario:');
  console.log({ username, email, password: plainPassword, question, answer });
  console.log('\nHashes generados:');
  console.log({ passwordHash, answerHash });
}

main().catch((err) => {
  console.error('Error seeding usuario', err);
  process.exit(1);
});
