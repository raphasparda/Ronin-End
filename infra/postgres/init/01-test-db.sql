-- Executado pela imagem oficial do Postgres somente na primeira inicializacao do volume.
-- Cria o banco usado pelos testes de integracao da API (TEST_DATABASE_URL).
CREATE DATABASE ronin_test OWNER ronin;
