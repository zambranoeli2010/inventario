USE railway;

-- Borramos si existe para empezar de cero y limpio
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(190) NOT NULL UNIQUE,
  email VARCHAR(190) NULL,
  password_hash VARCHAR(255) NOT NULL,
  visible_password VARCHAR(190) NOT NULL,
  security_question VARCHAR(255) NOT NULL,
  security_answer_hash VARCHAR(255) NOT NULL,
  last_login_at DATETIME NULL, -- <--- ESTA ES LA QUE DABA ERROR
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS transactions (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

USE railway;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS transactions;