-- Usar el schema público por defecto

-- Tabla de salespersons
CREATE TABLE IF NOT EXISTS salesperson (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    telegramid VARCHAR(50),
    warning_count INTEGER DEFAULT 0
);

-- Tabla de branches
CREATE TABLE IF NOT EXISTS branch (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL
);

-- Tabla de estados
CREATE TABLE IF NOT EXISTS status (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL
);

-- Tabla de estimates
CREATE TABLE IF NOT EXISTS estimate (
    id SERIAL PRIMARY KEY,
    created_date TIMESTAMP NOT NULL,
    name VARCHAR(200) NOT NULL,
    status_id INTEGER REFERENCES status(id),
    branch_id INTEGER REFERENCES branch(id),
    salesperson_id INTEGER REFERENCES salesperson(id),
    CONSTRAINT estimate_name_created_date_unique UNIQUE (name, created_date)
);

-- Tabla para registrar ejecuciones del script de actualización
CREATE TABLE IF NOT EXISTS update_log (
    id SERIAL PRIMARY KEY,
    executed_at TIMESTAMP NOT NULL DEFAULT NOW(),
    message TEXT
); 