/**
 * Límites de longitud de los inputs de texto que llegan del usuario.
 *
 * No hay `check` de columna en la base (decisión L5): se valida en la capa de
 * app, antes de tocar Supabase/Postgres, para no romper filas que ya existen en
 * producción. Los límites viven acá —una sola fuente— y no copiados en cada
 * formulario, por la misma razón que `safeNextPath`: si un campo queda sin
 * límite, queda sin límite.
 *
 * Los valores son deliberadamente holgados, no "máximos de UI": el objetivo es
 * frenar el abuso (un mail de 2MB que traba el servidor), no acotar el dato
 * legítimo.
 */
export const MAX_EMAIL_LENGTH = 254 // RFC 5321
export const MAX_PASSWORD_LENGTH = 72 // límite efectivo de bcrypt (lo que pasa de acá se trunca igual)
export const MAX_DISPLAY_NAME_LENGTH = 100
export const MAX_SEASON_NAME_LENGTH = 100
export const MAX_RULES_TEXT_LENGTH = 20000
