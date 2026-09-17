-- Setup do PostgreSQL NATIVO para desenvolvimento (sem Docker).
-- Cria o role "kanban" (senha "kanban", SOMENTE DEV) e os bancos "kanban" e "kanban_test".
-- Idempotente: pode ser executado quantas vezes quiser.
--
-- Executar uma vez, como superusuario (postgres), a partir da raiz do repositorio:
--   PowerShell:
--     & "C:\Program Files\PostgreSQL\18\bin\psql.exe" -h 127.0.0.1 -U postgres -d postgres -f infra/postgres/local-setup.sql
--   Linux/macOS:
--     psql -h 127.0.0.1 -U postgres -d postgres -f infra/postgres/local-setup.sql
--
-- Requer psql (usa \gexec, pois CREATE DATABASE nao roda dentro de bloco DO).
-- Nunca use este script nem esta senha em producao.

\set ON_ERROR_STOP on

-- Role de aplicacao (sem superusuario, sem CREATEDB, sem CREATEROLE).
SELECT 'CREATE ROLE kanban LOGIN'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kanban')
\gexec

ALTER ROLE kanban WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD 'kanban';

-- Bancos (UTF8, a partir do template0 para nao herdar objetos do template1).
SELECT 'CREATE DATABASE kanban OWNER kanban ENCODING ''UTF8'' TEMPLATE template0'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'kanban')
\gexec

SELECT 'CREATE DATABASE kanban_test OWNER kanban ENCODING ''UTF8'' TEMPLATE template0'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'kanban_test')
\gexec

-- Garante o dono caso os bancos ja existissem com outro dono.
ALTER DATABASE kanban OWNER TO kanban;
ALTER DATABASE kanban_test OWNER TO kanban;

SELECT datname AS banco, pg_get_userbyid(datdba) AS dono, pg_encoding_to_char(encoding) AS encoding
FROM pg_database
WHERE datname IN ('kanban', 'kanban_test')
ORDER BY datname;
