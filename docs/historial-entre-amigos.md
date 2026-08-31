# Historial entre amigos — diseño

**Escrito el 31 de agosto de 2026.** Nada de esto está implementado. El documento
es el resultado de una conversación de diseño con el dueño del producto y de una
exploración del código medida contra el árbol de ese día
(`feature/torneo-multi-disciplina`, `1d58efa`).

---

## 0 · El reencuadre

La app de hoy tiene una sola forma de que exista un partido: adentro de un
torneo. El modelo es estrictamente jerárquico y no por convención —
`matches.matchday_id` es `not null`, y los rivales son claves foráneas contra
`pairs`, que cuelgan de la fecha (`0001_schema.sql:177-189`):

```
temporada → disciplina → fecha → pareja → partido
```

Eso está bien para un campeonato de doce y está mal para dos amigos que se
juntan a jugar al FIFA. La pregunta que abrió esto la hizo el dueño del
producto:

> *"Hace falta crear un torneo con 1 jugador para tener un historial? porque si
> tenes 10 amigos, tenes que crear un torneo con cada uno, medio raro."*

Y la respuesta es que no. **Lo que falta no es un tipo de torneo más chico: es
otra cosa.** Agregás a alguien como amigo, y su perfil muestra todos los
partidos que jugaron juntos —los que salieron de un torneo y los del sillón—,
en cualquier deporte, con la posibilidad de cargar uno nuevo ahí mismo.

Es el objetivo que la app tiene declarado desde el principio y que nunca se
construyó: *"que con tus amigos puedas armar torneos fácilmente y que puedas
tener un historial de todos los que jugaron."*

---

## 1 · La decisión de fondo: unir al leer, no al guardar

Se evaluaron tres formas. La elegida es la primera.

### 1.1 Unir al leer *(elegida)*

Dos cosas nuevas —la amistad, y el partido casual con la forma que ese partido
necesita— y **el perfil del amigo es una consulta que junta las dos fuentes**.
El modelo del torneo no se toca.

Lo que la vuelve barata es un hecho medido: **la mitad del historial ya está
escrita.** Los partidos de torneo están en la base con sus resultados, así que
sacar "todos los partidos entre X e Y" de ahí es una consulta. Es exactamente lo
que `tipos-de-torneo.md` §2.6 llamaba *"modelo intacto"*.

### 1.2 Unificar de verdad *(descartada)*

Hacer `matches` independiente, `matchday_id` opcional, generalizar los
participantes. Conceptualmente es más limpio: un solo concepto de partido.

Se descarta porque es abrir el corazón de un sistema con 69 migraciones, RLS
sobre diez tablas, funciones `security definer` y datos reales en producción
**para que el usuario vea exactamente lo mismo**. Cuando el costo es enorme y el
resultado visible es idéntico, la respuesta es no.

### 1.3 Un torneo escondido de dos por amistad *(descartada)*

Reusa todo y no escribe nada nuevo. La descartó el dueño del producto solo:
arrastra puntos, fechas y tabla de posiciones a algo que no es una competencia.
Y con diez amigos son diez torneos y ningún lugar donde ver el historial con
uno.

### 1.4 Por qué el partido casual no entra en `matches` ni forzándolo

Esto es lo que confirma que son dos objetos y no uno con un campo opcional:

- No tiene fecha ni parejas, y las dos cosas son `not null` con FK.
- Necesita datos que el partido de torneo no tiene: con qué equipo jugó cada
  uno, y quién ganó cuando el marcador quedó empatado.
- `core/types.ts: MatchResult` se hizo para sets y games de una fecha. No tiene
  dónde poner nada de eso y nunca se pensó para eso.

---

## 2 · La identidad del amigo

### 2.1 Un amigo puede ser sólo un nombre

Se puede empezar a anotar partidos contra alguien que no tiene cuenta.

**El nombre vive en la fila de la amistad, no en `players`.** La amistad guarda
un `display_name` escrito por vos y un `player_id` que arranca en **null** y se
llena el día que se resuelva (§2.3). Eso importa más de lo que parece: significa
que **esta feature nunca escribe en `players`**, una tabla que este código tiene
cerrada para escritura desde el día uno y a propósito (§5.5). El único que crea
jugadores sigue siendo el registro de una cuenta.

Esto no es una concesión: es lo que hace que la app se pueda usar el primer día.
Si Juan tiene que registrarse antes de que puedas anotar nada, no anotás nada.

Y no es una fuga del incentivo, es la carnada: cuando le mandás el link, **Juan
no llega a una app vacía**. Llega a veinte partidos que ya lo esperan, con su
récord contra vos. Es infinitamente más incentivador que empezar de cero.

### 2.2 El mapeo no es automático, y eso es la decisión, no una limitación

Cuando Juan se registra, **nada se fusiona solo**. Ni por nombre parecido, ni
por nombre exacto.

La razón es simple: podés tener dos amigos que se llamen Juan. El sistema no
tiene forma de saber cuál es cuál, y el día que adivine mal le mete a alguien el
historial de otro. Eso no se arregla con mejor código.

Hay exactamente una persona que sí sabe: **vos**, que escribiste el nombre.

### 2.3 Aceptar un amigo y mapear un historial son dos acciones distintas

Es la corrección más importante que salió de la conversación, y viene de un caso
que rompe la analogía fácil con `claim_seat`.

`claim_seat` (`0004_claim_seat.sql`) funciona porque **hay un contenedor y un
token**: el torneo existe, tiene un link, y quien llega elige su nombre de *esa*
lista de ocho. Una amistad no tiene contenedor, y el flujo va al revés — Juan se
registra por su cuenta y manda solicitud. No hay lista de dónde elegir.

Entonces:

| acción | qué pasa |
|---|---|
| **Llega una solicitud y la aceptás** | Nada más. Es un amigo. Cero preguntas. |
| **Mapear un nombre a una cuenta** | Lo arrancás vos, cuando querés, desde tu lista. |

El camino normal —una solicitud de alguien con quien no tenías nada anotado— no
tiene ni un paso de más. Va a ser la enorme mayoría de las veces.

Y el mapeo lo iniciás vos: entrás al nombre que escribiste, decís *"esto en
realidad es este amigo"*, elegís de tu lista, y se funden. **La app no ofrece
candidatos.**

### 2.4 Un nombre sin cuenta es un final válido

No es un pendiente. La app no lo marca con un puntito rojo ni te lo recuerda. Tu
primo que no se va a registrar nunca es un estado terminal legítimo.

### 2.5 La amistad va entre `players`, no entre cuentas

Cuando la amistad **está resuelta**, apunta a un `players.id`. La razón es que
los asientos de un torneo son `players` (`entries.player_id`), así que es lo
único que permite cruzar las dos fuentes del historial.

Mientras **no** está resuelta, no apunta a nada: es el `display_name` de la
propia fila (§2.1). Así que la amistad tiene dos estados y no hace falta una
fila fantasma en `players` para el primero.

---

## 3 · Quién escribe la verdad

### 3.1 Los dos pueden editar y borrar

Cualquiera de los dos puede tocar cualquier partido del historial compartido.

El motivo sale de §2.3: después de fusionar, los partidos que cargaste vos
aterrizan en la cuenta de Juan. Si sólo el autor pudiera editarlos, un error tuyo
queda congelado para Juan **para siempre**, y el producto deja de ser *nuestro
historial* y pasa a ser *tu registro sobre Juan*, que él mira de afuera.

### 3.2 Cada partido guarda quién lo cargó y quién lo tocó último, y se muestra

Es la condición que hace funcionar la regla de arriba. La decisión del dueño del
producto fue explícita: *"Si tiene algo que discutir que lo haga con el amigo"* —
la app no arbitra.

Pero para que puedan discutirlo **tienen que poder ver que algo cambió**. Si Juan
edita un resultado y la pantalla no dice nada, no hay discusión posible: hay un
historial que mutó solo.

Son dos columnas y una línea abajo del resultado. **No es un log de auditoría ni
un historial de versiones** — eso sí sería sobreconstruir.

### 3.3 Borrar también pueden los dos

Si tu amigo te borra los partidos que perdió, tenés un problema de amigo, no de
software. La app no lo puede arreglar y no tiene que intentarlo.

### 3.4 Los duplicados no se detectan, a propósito

Hay un caso que ninguna regla de permisos arregla: juegan el sábado y **lo
cargan los dos**. El historial dice que jugaron dos veces.

**Se decide no resolverlo.** En la práctica siempre hay uno que carga, y si pasa
se arregla solo: uno lo ve, borra el suyo, listo. Detectar duplicados pide
adivinar si dos partidos parecidos son el mismo — y adivinar es justamente lo
que este diseño saca de encima en §2.2. Es preferible un duplicado visible y
borrable que un detector que un día fusione dos partidos que sí fueron
distintos.

---

## 4 · La forma del partido casual

### 4.1 El deporte es texto, y la pantalla lo normaliza

Hoy la app conoce dos deportes y viven colgados de una temporada
(`disciplines.kind`, `check (kind in ('PADEL','FIFA'))`), así que no se pueden
referenciar desde afuera. Y el historial casual es justamente donde entra el
ping pong.

El deporte se guarda como texto, y **al cargar, el campo sugiere los que ya
usaste**. La normalización la hace la pantalla, no el esquema: sin tabla nueva,
sin catálogo que alguien tenga que mantener.

> `ponytail:` el riesgo conocido es escribir "Fifa" y "FIFA" y partir el
> historial en dos. Lo evita la sugerencia. Si algún día hace falta un modelo de
> deportes de verdad —para agrupar, para estadísticas por deporte— ahí se
> promueve a tabla.

### 4.2 Quién ganó es un dato propio, no se deduce del marcador

Esto salió del ejemplo del dueño del producto y es la parte no obvia del diseño.

En FIFA, un 2-2 puede cerrar empatado **o** terminar con un ganador — y si hay
ganador, es por penales, necesariamente. No hay otra forma. Entonces **ningún
cálculo sobre el marcador puede decir quién ganó**, y "quién ganó" tiene que
guardarse aparte.

| campo | obligatorio | por qué |
|---|---|---|
| **quién ganó, o empate** | sí | no se puede deducir; ver arriba |
| **marcador**, dos números | no | a veces sólo te acordás de que perdiste |
| **equipo de cada uno**, texto | no | "Boca", "Real Madrid". Sirve para FIFA, no molesta en pádel |

### 4.3 No hay campo "por penales"

Se propuso y **se sacó**: es derivable. Marcador empatado + un ganador ya lo
dice, y no hay otro caso — confirmado con el dueño del producto. Guardarlo
aparte sólo abre la puerta a que alguien tilde "penales" en un 3-1 y quede un
registro que se contradice solo.

Esto **no es la app adivinando** (§2.2). Adivinar era la identidad, donde había
varias respuestas posibles. Acá hay una sola: es una consecuencia, no una
hipótesis.

Donde sí cambia algo es en la pantalla, y para mejor: **al cargar un marcador
empatado, la app pregunta** *"¿quedó empatado o ganó alguien?"*. No lo asume. El
empate es una respuesta tan válida como la otra.

En el historial se muestra el hecho y no la interpretación: **"2-2 · ganó
Juan"**. No dice "por penales" porque el deporte es texto libre y la app no sabe
que "FIFA" es fútbol; etiquetarlo sería afirmar algo sobre un deporte que no
modela.

---

## 5 · Lo medido — lo que hay que saber antes de escribir una línea

Todo esto se verificó contra el árbol el 31/08/2026. Las primeras dos son
correcciones a suposiciones que se hicieron en voz alta y estaban mal.

### 5.1 La cadena de joins real

**No** pasa por `attendances` ni por `discipline_entries` — eso se dijo y es
falso. La cadena es:

```
players.id = entries.player_id          (0001_schema.sql:58,88)
entries.id = pairs.entry_a / entry_b    (0001_schema.sql:157-158, 0028_side_size.sql:68-77)
pairs.id   = matches.pair_a / pair_b    (0001_schema.sql:181-182)
matches.id = match_sets.match_id
```

### 5.2 `pairs.entry_b` es nullable, y un `INNER JOIN` borra el FIFA entero

Con disciplinas de a uno, `entry_b` viene en null (`0028_side_size.sql:68,75-77`).
Un `inner join` sobre esa columna —que es lo que uno escribe sin pensar—
**elimina silenciosamente todos los partidos individuales** del historial. La
suite pasaría, la pantalla andaría, y justo el caso que motivó la feature no
aparecería nunca. Tiene que ser `left join`.

### 5.3 Con un amigo se juega DE COMPAÑERO y EN CONTRA

En pádel de a dos, con Juan podés estar en la misma pareja o enfrentado. Las dos
son "partidos con Juan" para el usuario. Una sola consulta las devuelve, pero
clasificarlas es lógica posterior **sin precedente en el código**:
`core/playerstats.ts:128-189` (`partnerRecords`, `bestPair`) sólo calculó el lado
de compañero, acotado a una temporada, nunca el de rival.

La pantalla probablemente tenga que mostrar las dos cosas por separado —
*"jugamos juntos 12, uno contra el otro 30"*.

### 5.4 La misma persona es la misma fila de `players`, con dos agujeros

`claim_seat` (`0004_claim_seat.sql:43-83`) le da al mismo humano el mismo
`players.id` en todas las temporadas que reclame con una cuenta. **La base del
enfoque se sostiene.** Pero:

1. **Los asientos nunca reclamados no se unifican jamás.** `add_squad_seat` crea
   entradas con `player_id` en null, y `promote_guest`
   (`0014_promote_guest.sql:379-381`) tampoco lo setea nunca — su propio
   comentario admite que dos invitados con el mismo nombre no se fusionan. Quien
   sólo fue un nombre escrito es invisible para una feature basada en `players`
   hasta que se registre.
2. Dos cuentas para un mismo humano son dos filas sin fusionar. No existe
   deduplicación. Fuera de alcance, pero anotado.

### 5.5 `players` está cerrada para escritura desde el día uno

El único que escribe `players` en código de producción es `handle_new_user`
(`0003_new_user.sql`, `security definer`, disparado al insertarse en
`auth.users`). La política lo dice con todas las letras (`0002_rls.sql:132-137`):
*"nadie inserta a mano… nadie edita"*.

La **lectura**, en cambio, está abierta: `players_read: using (true)`. Así que
"agregar como amigo a alguien que ya tiene cuenta" **no necesita ninguna
superficie de lectura nueva**.

**Y esta feature no la abre.** Los amigos sin cuenta guardan su nombre en la
fila de la amistad, no en `players` (§2.1), así que la tabla sigue tan cerrada
como está hoy y `handle_new_user` sigue siendo su único escritor. Era la
alternativa obvia y habría costado abrir una superficie que este código cerró a
propósito; no hace falta.

### 5.6 `core/` no se toca

Verificado grepeando todos los imports de `core/*.ts`: cero referencias a `db/` o
a `supabase`. Todas sus funciones están acotadas a `EntryId` y ninguna conoce
`player_id`. **El historial no alimenta tablas de posiciones, ni premios, ni
rankings**, así que no hay nada que agregarle. Los helpers de `core/side.ts`
(`sideOfRow`, `members`) se reusan tal cual en la capa de lectura.

---

## 6 · Riesgos

| riesgo | dónde | mitigación |
|---|---|---|
| **CRÍTICO — fuga de historial entre cuentas** | la RPC del historial | Una función `security definer` que reciba los dos jugadores como parámetros **saltea RLS y deja pedir el historial de dos personas cualesquiera**. La convención del repo ya lo resuelve: `claim_seat` (`0004:58`) y `my_player_id` (`0006:6-14`) **derivan la identidad de `auth.uid()` del lado del servidor y nunca la reciben**. Obligatorio acá. |
| **Tabla nueva sin los DOS permisos** | las migraciones | Toda tabla nueva necesita el `grant` a `authenticated`/`service_role` (el CLI no lo da solo) **y** el `revoke all … from anon` (Supabase Cloud sí le otorga DML a `anon` en la nube — medido en producción, `estado.md`). Este repo ya se comió las dos, en `0002` y `0009`. Falta cualquiera y se repite un defecto que llegó a producción. |
| **El FIFA desaparece del historial** | la consulta de unión | `left join` sobre `pairs.entry_b`, ver §5.2. Test explícito con una disciplina de a uno. |
| **N+1 al cruzar temporadas** | la capa de lectura | `pairsAndMatchesOf` (`db/read.ts:985-1046`) hoy se llama una vez por fecha adentro de un loop. Una consulta que cruza temporadas **no puede** replicar eso: va una sola consulta con join. |
| **Una fusión equivocada se lleva 20 partidos** | §2.3 | Tiene que poder deshacerse. No está diseñado todavía — ver §8. |

---

## 7 · Lo que este diseño NO hace

- **No toca el modelo del torneo.** Ninguna tabla, ninguna función, ninguna
  migración existente.
- **No toca `season_public_rules`**, que está viva en producción.
- **No detecta duplicados** (§3.4).
- **No fusiona nada automáticamente** (§2.2).
- **No resuelve el pádel casual de a cuatro.** Todo lo diseñado es un partido
  entre vos y **un** amigo. Cuatro personas y dos lados abren una pregunta que
  todavía no tiene respuesta —¿en el historial de quién va?— y multiplican el
  modelo por una duda de producto sin resolver. El modelo no se cierra en contra
  de agregarlo después.
- **No deduplica dos cuentas del mismo humano** (§5.4).
- **No arbitra disputas.** Se hablan afuera (§3.2).

---

## 8 · Lo que queda abierto

1. **Cómo se deshace una fusión.** Está identificado como riesgo y no diseñado.
2. **Qué ve Juan cuando le aterrizan 20 partidos que no cargó.** Los ve, eso
   está decidido. Si además le llega algún aviso, no.
3. **La forma exacta de la pantalla del amigo**, en particular si separa
   "jugamos juntos" de "jugamos en contra" (§5.3).
4. **Si el historial incluye los torneos donde jugaron pero no se enfrentaron
   nunca.** Estuvieron en la misma temporada y no les tocó cruzarse: ¿aparece?

---

**Fuentes:** conversación de diseño del 31/08/2026 con el dueño del producto
(engram `sdd/historial-entre-amigos/decision`), y la exploración del código
(engram `sdd/historial-entre-amigos/explore`). Todas las referencias
`archivo:línea` fueron verificadas contra el árbol del 31/08/2026.
