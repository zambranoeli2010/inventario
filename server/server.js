import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';

const {
  DB_HOST,
  DB_PORT = 3306,
  DB_USER,
  DB_PASSWORD,
  DB_NAME,
  APP_PORT = 3001,
  ALLOWED_ORIGINS = 'http://localhost:5173,http://localhost:3000,http://localhost:5500'
} = process.env;

const TX_CATEGORIES = ['tintas', 'franelas', 'gasolina', 'hojas de sublimacion', 'bolsas plasticas', 'bolsa de empaques', 'cinta'];
const TX_NATURE = ['activo', 'pasivo'];
const TX_TYPES = ['ingreso', 'egreso'];
const INV_SIZES = ['12', '14', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];

if (!DB_HOST || !DB_USER || !DB_PASSWORD || !DB_NAME) {
  console.error('Faltan variables de entorno de base de datos. Revisa .env');
  process.exit(1);
}

const origins = ALLOWED_ORIGINS.split(',').map((o) => o.trim());
const app = express();
app.use(cors({
  origin: [
    ...origins,
    'https://inventario-1-v9od.onrender.com'
  ],
  credentials: true
}));
app.use(express.json());

const pool = mysql.createPool({
  host: DB_HOST,
  port: Number(DB_PORT),
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  connectionLimit: 10
});

const ensureSchema = async () => {
  const [lastLoginCol] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'last_login_at'`,
    [DB_NAME]
  );
  if (!lastLoginCol[0]?.total) {
    await pool.query('ALTER TABLE users ADD COLUMN last_login_at DATETIME NULL');
  }

  const createSql = `CREATE TABLE IF NOT EXISTS transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tipo ENUM('ingreso','egreso') NOT NULL DEFAULT 'egreso',
    categoria ENUM('tintas','franelas','gasolina','hojas de sublimacion','bolsas plasticas','bolsa de empaques','cinta') NOT NULL,
    naturaleza ENUM('activo','pasivo') NOT NULL DEFAULT 'pasivo',
    monto DECIMAL(12,2) NOT NULL,
    fecha DATE NOT NULL,
    nota TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_fecha (fecha)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;
  await pool.query(createSql);

  const createInventorySql = `CREATE TABLE IF NOT EXISTS inventory_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    producto VARCHAR(190) NOT NULL,
    tela VARCHAR(190) NOT NULL,
    talla VARCHAR(20) NOT NULL,
    precio DECIMAL(12,2) NOT NULL,
    lote VARCHAR(100) NOT NULL,
    cantidad INT NOT NULL,
    aprobado TINYINT(1) NOT NULL DEFAULT 0,
    entrada_at DATETIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_entrada (entrada_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;
  await pool.query(createInventorySql);
};

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  console.log('LOGIN payload:', req.body);
  if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });

  try {
    const [rows] = await pool.query(
      'SELECT id, username, password_hash FROM users WHERE username = ? LIMIT 1',
      [username]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Credenciales inválidas' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });

    const now = new Date();
    await pool.query('UPDATE users SET last_login_at = ? WHERE id = ?', [now, user.id]);
    res.json({ success: true, message: 'Autenticado', lastLoginAt: now.toISOString(), username: user.username });
  } catch (err) {
    console.error('Error en login', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.get('/api/last-login', async (_req, res) => {
  try {
    const [rows] = await pool.query('SELECT last_login_at FROM users WHERE last_login_at IS NOT NULL ORDER BY last_login_at DESC LIMIT 1');
    res.json({ lastLoginAt: rows[0]?.last_login_at ? new Date(rows[0].last_login_at).toISOString() : null });
  } catch (err) {
    console.error('Error consultando última sesión', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.post('/api/recover', async (req, res) => {
  const { username, answer } = req.body || {};
  console.log('RECOVER payload:', req.body);
  if (!username || !answer) return res.status(400).json({ error: 'Usuario y respuesta son requeridos' });

  try {
    const [rows] = await pool.query(
      'SELECT id, security_answer_hash, visible_password FROM users WHERE username = ? LIMIT 1',
      [username]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const ok = await bcrypt.compare(answer.toLowerCase().trim(), user.security_answer_hash);
    if (!ok) return res.status(401).json({ error: 'Respuesta incorrecta' });

    // visible_password existe solo para cumplir requisito de mostrar password en claro.
    res.json({ success: true, password: user.visible_password });
  } catch (err) {
    console.error('Error en recover', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

const validateTx = (payload) => {
  const tipo = String(payload.tipo || '').toLowerCase();
  const categoria = String(payload.categoria || '').toLowerCase();
  const naturaleza = String(payload.naturaleza || '').toLowerCase();
  const monto = Number(payload.monto);
  const fecha = payload.fecha;
  const nota = payload.nota ? String(payload.nota) : null;

  if (!TX_TYPES.includes(tipo)) return { ok: false, error: 'Tipo debe ser ingreso o egreso' };
  if (!TX_CATEGORIES.includes(categoria)) return { ok: false, error: 'Categoría inválida' };
  if (!TX_NATURE.includes(naturaleza)) return { ok: false, error: 'Naturaleza debe ser activo o pasivo' };
  if (!Number.isFinite(monto) || monto <= 0) return { ok: false, error: 'Monto debe ser mayor a 0' };
  if (!fecha) return { ok: false, error: 'Fecha requerida' };

  return {
    ok: true,
    data: { tipo, categoria, naturaleza, monto: Number(monto.toFixed(2)), fecha, nota }
  };
};

app.get('/api/transactions', async (_req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, tipo, categoria, naturaleza, monto, DATE_FORMAT(fecha, "%Y-%m-%d") AS fecha, nota FROM transactions ORDER BY fecha DESC, id DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error('Error listando transacciones', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.post('/api/transactions', async (req, res) => {
  const check = validateTx(req.body || {});
  if (!check.ok) return res.status(400).json({ error: check.error });
  const { tipo, categoria, naturaleza, monto, fecha, nota } = check.data;
  try {
    const [result] = await pool.query(
      'INSERT INTO transactions (tipo, categoria, naturaleza, monto, fecha, nota) VALUES (?,?,?,?,?,?)',
      [tipo, categoria, naturaleza, monto, fecha, nota]
    );
    res.status(201).json({ id: result.insertId, ...check.data });
  } catch (err) {
    console.error('Error creando transacción', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.put('/api/transactions/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Id inválido' });
  const check = validateTx(req.body || {});
  if (!check.ok) return res.status(400).json({ error: check.error });
  const { tipo, categoria, naturaleza, monto, fecha, nota } = check.data;
  try {
    const [result] = await pool.query(
      'UPDATE transactions SET tipo=?, categoria=?, naturaleza=?, monto=?, fecha=?, nota=? WHERE id=?',
      [tipo, categoria, naturaleza, monto, fecha, nota, id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json({ id, ...check.data });
  } catch (err) {
    console.error('Error actualizando transacción', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.delete('/api/transactions/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Id inválido' });
  try {
    const [result] = await pool.query('DELETE FROM transactions WHERE id=?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json({ success: true });
  } catch (err) {
    console.error('Error eliminando transacción', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

const validateInventory = (payload) => {
  const producto = String(payload.producto || '').trim();
  const tela = String(payload.tela || '').trim();
  const talla = String(payload.talla || '').trim().toUpperCase();
  const lote = String(payload.lote || '').trim();
  const precio = Number(payload.precio);
  const cantidad = Number(payload.cantidad);
  const aprobado = Boolean(payload.aprobado);
  const entradaAtRaw = payload.entradaAt || payload.entrada_at;
  const entradaAt = entradaAtRaw ? new Date(entradaAtRaw) : new Date();

  if (!producto) return { ok: false, error: 'Producto requerido' };
  if (!tela) return { ok: false, error: 'Tela requerida' };
  if (!INV_SIZES.includes(talla)) return { ok: false, error: 'Talla inválida' };
  if (!lote) return { ok: false, error: 'Lote requerido' };
  if (!Number.isFinite(precio) || precio <= 0) return { ok: false, error: 'Precio inválido' };
  if (!Number.isFinite(cantidad) || cantidad <= 0) return { ok: false, error: 'Cantidad inválida' };
  if (Number.isNaN(entradaAt.getTime())) return { ok: false, error: 'Fecha de entrada inválida' };

  return {
    ok: true,
    data: {
      producto,
      tela,
      talla,
      lote,
      precio: Number(precio.toFixed(2)),
      cantidad: Math.round(cantidad),
      aprobado,
      entradaAt
    }
  };
};

app.get('/api/inventory', async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, producto, tela, talla, precio, lote, cantidad, aprobado,
              DATE_FORMAT(entrada_at, '%Y-%m-%d %H:%i:%s') AS entradaAt
       FROM inventory_items
       ORDER BY entrada_at DESC, id DESC`
    );
    const mapped = rows.map((row) => ({ ...row, aprobado: Boolean(row.aprobado) }));
    res.json(mapped);
  } catch (err) {
    console.error('Error listando inventario', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.post('/api/inventory', async (req, res) => {
  const check = validateInventory(req.body || {});
  if (!check.ok) return res.status(400).json({ error: check.error });
  const { producto, tela, talla, precio, lote, cantidad, aprobado, entradaAt } = check.data;
  try {
    const [result] = await pool.query(
      `INSERT INTO inventory_items (producto, tela, talla, precio, lote, cantidad, aprobado, entrada_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [producto, tela, talla, precio, lote, cantidad, aprobado ? 1 : 0, entradaAt]
    );
    res.status(201).json({ id: result.insertId, ...check.data, entradaAt: entradaAt.toISOString() });
  } catch (err) {
    console.error('Error creando inventario', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.put('/api/inventory/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Id inválido' });
  const check = validateInventory(req.body || {});
  if (!check.ok) return res.status(400).json({ error: check.error });
  const { producto, tela, talla, precio, lote, cantidad, aprobado, entradaAt } = check.data;
  try {
    const [result] = await pool.query(
      `UPDATE inventory_items
       SET producto=?, tela=?, talla=?, precio=?, lote=?, cantidad=?, aprobado=?, entrada_at=?
       WHERE id=?`,
      [producto, tela, talla, precio, lote, cantidad, aprobado ? 1 : 0, entradaAt, id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json({ id, ...check.data, entradaAt: entradaAt.toISOString() });
  } catch (err) {
    console.error('Error actualizando inventario', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.delete('/api/inventory/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Id inválido' });
  try {
    const [result] = await pool.query('DELETE FROM inventory_items WHERE id=?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json({ success: true });
  } catch (err) {
    console.error('Error eliminando inventario', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

await ensureSchema();
app.listen(APP_PORT, () => console.log(`API Toque Divino en puerto ${APP_PORT}`));
