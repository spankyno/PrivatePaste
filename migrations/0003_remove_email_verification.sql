-- Migration: 0003_remove_email_verification.sql
-- Elimina la verificación de email (revierte 0002_email_verification.sql).
--
-- Sin dominio verificado en Resend no había forma de enviar el correo de
-- verificación de forma fiable, así que se retira la funcionalidad. El
-- anti-abuso en el registro queda a cargo de Turnstile únicamente; las
-- cuentas nuevas obtienen el tier 'registered' completo desde el alta.
--
-- La tabla `verifications` no se elimina: es el mismo vestigio del scaffold
-- inicial que ya existía antes de 0002 (sin uso), se deja tal cual por si
-- se reutiliza en el futuro (p. ej. reseteo de contraseña).

DROP INDEX IF EXISTS idx_verifications_identifier;
DROP INDEX IF EXISTS idx_verifications_value;

ALTER TABLE users DROP COLUMN email_verified_at;
