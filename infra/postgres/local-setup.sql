-- Setup do PostgreSQL NATIVO para desenvolvimento (sem Docker).
-- Cria o role "ronin" (senha "ronin", SOMENTE DEV) e os bancos "ronin" e "ronin_test".
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
SELECT 'CREATE ROLE ronin LOGIN'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ronin')
\gexec

ALTER ROLE ronin WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD 'ronin';

-- Bancos (UTF8, a partir do template0 para nao herdar objetos do template1).
SELECT 'CREATE DATABASE ronin OWNER ronin ENCODING ''UTF8'' TEMPLATE template0'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'ronin')
\gexec

SELECT 'CREATE DATABASE ronin_test OWNER ronin ENCODING ''UTF8'' TEMPLATE template0'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'ronin_test')
\gexec

-- Garante o dono caso os bancos ja existissem com outro dono.
ALTER DATABASE ronin OWNER TO ronin;
ALTER DATABASE ronin_test OWNER TO ronin;

SELECT datname AS banco, pg_get_userbyid(datdba) AS dono, pg_encoding_to_char(encoding) AS encoding
FROM pg_database
WHERE datname IN ('ronin', 'ronin_test')
ORDER BY datname;
