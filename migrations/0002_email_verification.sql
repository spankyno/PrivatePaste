-- Migration: 0002_email_verification.sql
-- Verificación de email en el registro.
--
-- Reutiliza la tabla `verifications` ya presente en el esquema inicial
-- (era un vestigio sin usar del scaffold "better-auth"): identifier=email
-- en minúsculas, value=token aleatorio de un solo uso.

ALTER TABLE users ADD COLUMN email_verified_at INTEGER; -- NULL = no verificado

CREATE INDEX IF NOT EXISTS idx_verifications_identifier ON verifications(identifier);
CREATE INDEX IF NOT EXISTS idx_verifications_value      ON verifications(value);
