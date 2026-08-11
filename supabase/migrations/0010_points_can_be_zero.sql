-- El último puede no sumar nada.
--
-- `awards.points` nacía con `check (points > 0)`, que acompañaba a la regla de
-- `validateConfig`: "si salir último diera 0, sería lo mismo que faltar". El
-- argumento es cierto —con `countBestOf`, una fecha jugada que pagó 0 cuenta lo
-- mismo que una a la que no fuiste— pero es una decisión de cada torneo, no una
-- regla del formato, y hay grupos que quieren exactamente eso.
--
-- Sin este cambio la config se podía guardar con un 0 y la fecha reventaba
-- recién al cerrarla, que es el peor momento posible: con los resultados ya
-- cargados y `close_matchday` a mitad de camino.
--
-- El negativo sigue prohibido: no significa nada. Y dos posiciones con el mismo
-- valor las sigue frenando `validateConfig` con `isStrictlyDescending`, así que
-- un 0 puede aparecer una sola vez y sólo al final.
alter table public.awards drop constraint awards_points_check;
alter table public.awards add  constraint awards_points_check check (points >= 0);
