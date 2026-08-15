-- Rôle applicatif non-superuser : Django (et pytest-django) se connectent
-- avec ce rôle, jamais avec keya_ecosystem_root. C'est ce qui permet à
-- FORCE ROW LEVEL SECURITY (posée en migration) de s'appliquer réellement :
-- un superuser ou le propriétaire d'une table sans FORCE contournerait
-- silencieusement toute policy RLS.
CREATE ROLE keya_ecosystem_app WITH LOGIN PASSWORD 'keya_ecosystem_app_password' CREATEDB;
ALTER DATABASE keya_ecosystem_db OWNER TO keya_ecosystem_app;
GRANT ALL PRIVILEGES ON DATABASE keya_ecosystem_db TO keya_ecosystem_app;
