# Segunda revisión crítica de usabilidad: TermoZona (verificación de arreglos y regresiones)

Fecha: 24-10-2026 (sábado, ~12:00 hora de Madrid). Demo en http://127.0.0.1:5391/, con Playwright (viewport 390×844, `es-ES`, `Europe/Madrid`), y lectura de `app/src/` (no se ha modificado nada en `app/`).

Evidencia en `docs/review-evidence/v2/`:
- `review2.mjs`: script reproducible por secciones (`node docs/review-evidence/v2/review2.mjs [login alta proximo home horario limite ausencia offline grande]`).
- `review2-log.json`: textos de pantalla en cada paso. En este informe se cita como `log:clave`.
- `aria-casa.txt` y `aria-horario.txt`: árbol de accesibilidad.
- `NN-*.png`: capturas del viewport, o de página completa cuando hace falta.

**Cómo se simularon los fallos.** El script intercepta en el navegador el módulo `src/demo/demoBridge.ts` y le añade tres ganchos: `__closeSock()` corta el socket, `__failAll` hace fallar la reconexión y `__failFtp` hace fallar la subida FTP. Así se probaron «sin conexión» (H-11), «subido pero no aplicado» (H-10) y «fallo al subir» (H-10, H-17). No se toca ningún archivo de `app/`. Para H-05 se fijó el reloj del navegador con `page.clock.setFixedTime`.

Leyenda: ✅ resuelto · ⚠️ parcial · ❌ no resuelto.

---

## 1. Verificación de H-01…H-22

| # | Estado | Qué se ha comprobado | Evidencia |
|---|---|---|---|
| H-01 Cambios compartidos | ✅ (con matices, ver N-04 y N-06) | Al editar desde Dormitorio un cambio copiado de Salón aparece «Este cambio también se aplica a **Salón**» con «Solo Dormitorio / En todas», y por defecto está marcado «Solo Dormitorio». Guardé a 22°: Dormitorio quedó a 22° y Salón siguió a 21° (el registro se dividió y el contador pasó de 6 a 7). El borrado dice «Quitar de Salón» y confirma con «Se quitará de Salón. Dormitorio lo mantendrá.»; Dormitorio lo conservó. El interruptor de la fila solo afectó a la zona actual. El copiado explica que se preguntará al editar. | `18-copiar.png`, `19-editar-compartido.png`, `20-salon-tras-editar-dormitorio.png`, `21-toggle-solo-una-zona.png`, `22-borrar-confirm.png`; `log:salon.trasEditarDormitorio`, `log:dormitorio.trasBorrarEnSalon` |
| H-02 Contraseña olvidada | ⚠️ | Ya existe el campo «Contraseña de esa cuenta» dentro de «Es mío», con error propio: «La contraseña no coincide con la de esa cuenta. Prueba otra vez…». También están «No recuerdo la contraseña» y «¿Has olvidado la contraseña?» en el login. **Pero la primera opción que se ofrece es «Probar a crear una cuenta nueva con otro nombre de usuario para el mismo TermoWifi»**, justo lo que H-02 pedía no sugerir (deja el equipo asociado a dos cuentas). Además, el caso «cuenta unida a otro TermoWifi» sigue terminando en «Elige otro nombre de usuario» (`CreateAccount.tsx` ≈l.180). | `01-login-olvido.png`, `02-alta-existe.png`, `03-alta-esmio-pass-mal.png`, `04-alta-no-recuerdo.png` |
| H-03 Acostarse después de medianoche | ⚠️ / **regresión** | Con 00:30 el asistente ya deja guardar, avisa «De madrugada, ya el día siguiente» y el resumen dice «00:30 (madrugada)». Crea un cambio de mar a sáb a las 00:30, lo cual es correcto. El editor manual avisa de que es madrugada. **Pero combinado con un horario de fin de semana rompe la noche del viernes** (N-01, P0) y la preselección de días (N-02). | `13-rapido-medianoche.png`, `14-despacho-laborables-0030.png`, `17-despacho-viernes-noche.png` |
| H-04 Conflictos | ⚠️ | El texto agrupado es correcto: «A las 23:00 (de lunes a viernes) hay dos cambios que piden temperaturas distintas: 20,5° y 18,0°. ¿Con cuál te quedas?». Hay botones por temperatura, las dos filas tienen borde de aviso y elegir resuelve el conflicto bien, incluso con cambios compartidos. «Añadir cambio» propone una hora libre (07:00 cuando 07:00 estaba libre). Falta: **no se avisa antes de guardar** un cambio que va a chocar (`log:nuevo.2300.avisoAntes = []`), y mientras dura el conflicto la vista semanal pinta 20,5° a todas horas como si no hubiera duda (`log:conflicto.semana`). | `23-nuevo-hora-libre.png`, `25-conflicto.png`, `26-conflicto-resuelto.png` |
| H-05 «Próximo… mañana» | ✅ | Con reloj fijo: sábado 11:40 → «Próximo: 21,0° el lunes a las 07:00»; viernes 22:00 → «hoy a las 23:00»; domingo 20:00 (después del cambio de hora) → «mañana a las 07:00»; lunes 06:30 → «hoy a las 07:00». | `06-home-proximo-sabado.png`; `log:proximo.*` |
| H-06 Modo ausencia | ⚠️ / **regresiones** | Existen «Me voy unos días» (temperatura de mantenimiento, aviso de que hay que volver a mano) y el banner «Ya he vuelto» en Casa y Horario. Volver restaura cambios y temperaturas. Pero el estado de ausencia vive **solo en este móvil**: al cerrar sesión, o desde otro móvil, el horario queda desactivado para siempre sin banner (N-03, P1). Durante la ausencia las tarjetas dicen «Sin horario» y los interruptores de cada cambio siguen activos (N-05). | `30`–`35-ausencia-*.png` |
| H-07 Vista semanal | ✅ / ⚠️ | Las temperaturas aparecen escritas en los tramos, la línea «Ahora, según el horario: 18,0° hasta las 24:00» está encima y hoy sale desplegado con sus franjas («00:00 – 24:00 18,0°»). Tocar otro día lo despliega. Pegas: «hasta las 24:00» cuando sigue igual al día siguiente; la marca de «ahora» atraviesa el número (`16-rapido-finde-avisos.png`, «18,0°» sábado); los tramos cortos (00:00–00:30) son invisibles. | `11-horario-salon.png`, `16-rapido-finde-avisos.png`, `17-despacho-viernes-noche.png` |
| H-08 Límite de 30 | ✅ / ⚠️ | Con 30, «Añadir cambio» sigue ahí y abre «Has llegado al máximo» con la explicación y qué hacer. Pero al dividir un compartido estando en 30 sale un error seco (N-04). | `27-limite-30.png` |
| H-09 Zona apagada | ✅ | «Tiene horario, pero está apagada: el horario no la enciende». | `08-home-salon-apagada.png` |
| H-10 Guardado en dos pasos | ⚠️ | Sin socket: «Horario guardado. Se aplicará en cuanto vuelva la conexión con tu calefacción.» y, al reconectar, la recarga se envía sola (`log:offline.reconexion.pending = false`). Si falla la subida: «No se ha podido guardar el horario… Pulsa «Guardar» para reintentarlo.», con el editor abierto. Faltan: no hay ningún indicador **permanente** de «pendiente de aplicar» (solo un aviso de 6 s; `log:offline.horario.indicadorPendiente` encontró únicamente el aviso), no se confirma cuando por fin se aplica, y el mensaje de fallo dice «Pulsa Guardar» también cuando el fallo viene del interruptor de una fila o de un botón de conflicto, donde no hay botón Guardar (`45-fallo-interruptor.png`). No hay botón «Reintentar» dentro del editor. | `43-guardado-pendiente.png`, `44-fallo-subida.png`, `45-fallo-interruptor.png` |
| H-11 Sin conexión | ⚠️ | En Casa hay un banner fijo: «Sin conexión con tu calefacción desde ahora mismo. Los datos pueden no estar al día y no se pueden hacer cambios.» con «Reintentar», y los reguladores aparecen atenuados. Pero: (1) solo se bloquean con `pointer-events:none`; con teclado o lector de pantalla siguen accionables (`log:offline.botonFocusable = true`) y, sin `aria-disabled`, nada anuncia que están desactivados. (2) La **ficha de zona** sigue con todo activo (preajustes y ±): al pulsar «Confort» solo sale el aviso pasajero (`41-sin-conexion-ficha.png`). (3) En **Horario** no hay banner (`log:offline.horario.banner = 0`). (4) «desde ahora mismo» suena raro. | `40-sin-conexion-casa.png`, `41`, `42-sin-conexion-horario.png` |
| H-12 Accesibilidad para mayores | ⚠️ | Mejorado: «Calefacción», «Calentando» y «Detalles» ya pasan 4,5:1. Los interruptores tienen zona táctil ampliada con `::before` (72×52) y la pastilla mide 44 px. Las tarjetas de Casa se reorganizan con texto grande y los avisos duran 6 s (10 s los errores). Queda: «Conectado» a 3,87:1; el botón flotante «Añadir cambio» (blanco sobre naranja, 17 px) a 3,58:1 en claro y **2,6:1 en oscuro**. Con texto al 200 % sigue habiendo desbordamiento horizontal: 438 px en Casa (se corta «Refrigeración»), 499 px en Horario y el editor; en Horario los interruptores de fila quedan **fuera de la pantalla** y las pestañas de zona, cortadas (`52-horario-texto-200.png`). Los avisos tapan el contenido de los paneles (`16-rapido-finde-avisos.png` tapa «Me acuesto a las»; `19-editar-compartido.png` tapa «Todos»). | `log:a11y.*`, `51`–`54-*-texto-200.png`, `50-horario-oscuro.png` |
| H-13 Identificar zonas en el alta | ✅ | «Zona 1 · ahora marca 20,5°…» y la indicación de comparar con la pantalla de cada termostato. | `05-alta-zonas-temperatura.png` |
| H-14 Cerrar con cambios sin guardar | ✅ | Escape pide «Tienes cambios sin guardar. ¿Quieres descartarlos?» con «Seguir editando / Descartar». | `24-descartar-pregunta.png` |
| H-15 Horario rápido para añadir días | ⚠️ | El botón se llama «Horario rápido (añadir o cambiar días)». Avisa «Sustituye lo que ya había…» y «Se mantiene lo de…». La preselección funciona en el caso simple, pero **falla tras un horario con madrugada** (N-02), el texto tiene una errata («Se mantiene lo de **de** lunes a viernes») y en ese caso las dos frases son engañosas (N-01). | `15-rapido-preseleccion-tras-0030.png`, `16-rapido-finde-avisos.png` |
| H-16 Confirmación de borrado | ✅ | El enlace está en y=957 y «Sí, borrar» en y=780, en un bloque rojo con «No». Dos toques seguidos ya no borran. | `22-borrar-confirm.png`; `log:borrar.cajas` |
| H-17 Renombrar en la nube | ✅ | «Nombre cambiado en todos los móviles.» y `Instal.dat` de la demo contiene «Habitación». Con la subida caída: «Nombre cambiado solo en este móvil…» (la nube conserva el anterior). | `09-renombrar.png`, `10-renombrar-nube.png`; `log:rename.*` |
| H-18 Orden numérico | ✅ | `sort((a, b) => a - b)` en `ZoneChips`, `zoneViews`, `parseInstal` y el alta. | Código |
| H-19 Hasta cuándo dura un cambio manual | ⚠️ | La ficha dice «Se mantendrá hasta hoy a las 23:00, cuando el horario la pondrá a 18,0°». Pero sale siempre, no solo tras un cambio manual, y **no aparece en la tarjeta de Casa**, que es donde se pulsa «+». | `07-zona-hasta-cuando.png` |
| H-20 Foto del TermoWifi | ❌ (aceptado) | Sin cambios, como se declaró. | — |
| H-21 Etiquetas accesibles | ✅ | Los botones dicen «Subir medio grado. Temperatura deseada en Salón». Las pestañas usan solo `aria-selected` y el valor de Casa ya no es `aria-live`. Sigue sin haber `tabpanel` (menor). | `aria-casa.txt`, `aria-horario.txt` |
| H-22 Interruptor por fila | ⚠️ | Existe, con etiqueta «Desactivar el cambio de las 23:00 en Salón». Pero en un compartido divide el registro y **no lo vuelve a unir al reactivarlo** (N-06), y si falla el aviso habla de «Guardar». | `21-toggle-solo-una-zona.png` |
| Volcado 0x23 por zona | ✅ (por código) | `requestDump` pide 0x23 y además `z*4+3` para cada zona; el simulador solo devuelve registros globales a 0x23. Las tarjetas se rellenan bien. | `controller.ts` ≈l.421-426, `demoBridge.ts` |

**Resumen:** 10 ✅, 11 ⚠️, 1 ❌ aceptado (H-20). El arreglo más importante (H-01) está bien hecho. Pero dos arreglos nuevos (H-03 junto con H-15, y H-06) introducen fallos graves.

---

## 2. Regresiones y problemas nuevos

### P0

**N-01. Un horario de fin de semana borra el «me acuesto» de la noche del viernes si el de laborables es de madrugada: el viernes se calienta toda la noche.**
- Pasos: Horario → Despacho → Crear horario rápido → L-V, me levanto 07:00, me acuesto **00:30** → Crear. Después, «Horario rápido (añadir o cambiar días)» → Fin de semana, 09:30 / 00:30 → Crear.
- Qué pasa: el cambio de 00:30 de laborables está guardado en mar-sáb (la madrugada del sábado es la noche del viernes). El asistente de fin de semana hace `removeCoverage(…, [S, D])` y le quita el sábado. Resultado: el viernes se queda a 21° de 07:00 a 24:00 y el sábado a 21° de 00:00 a 09:30 (`log:despacho.semana.semana`: «Sábado: de 00:00 a 09:30, 21,0°»). Antes de guardar, el asistente dice «Se mantiene lo de de lunes a viernes», lo cual es falso. El único indicio es «Sustituye lo que ya había: sáb.», que nadie va a relacionar con el viernes.
- Evidencia: `14-despacho-laborables-0030.png`, `16-rapido-finde-avisos.png`, `17-despacho-viernes-noche.png`.
- Dónde: `ui/SchedulePage.tsx:329-333` (`clearDays = days`; el comentario de l.328 asume que no pasa nada) y `core/schedule.ts:296` (`removeCoverage`).
- Propuesta: un cambio de madrugada (minuto < `SMALL_HOURS` y creado como «acostarse») pertenece al día **anterior**. Al calcular qué se sustituye, usa los días desplazados −1 para esos cambios: no quites el sábado de 00:30 si el sábado no estaba entre los días de *levantarse*. Más sencillo y robusto: en `removeCoverage`, para eventos con minuto < 05:00, compara con `shiftDays(days, 1)`. Añadir una prueba: laborables 00:30 + fin de semana → el sábado 00:30 sigue existiendo. Lo mismo al revés (rehacer laborables deja un sábado 00:30 huérfano).

### P1

**N-02. Tras un horario con madrugada, el asistente preselecciona solo el domingo.**
- Pasos: como en N-01, tras crear L-V con 00:30, pulsar «Horario rápido (añadir o cambiar días)».
- Qué pasa: los días marcados son solo **D** (`log:rapido.finde.preseleccion`), porque el sábado «está cubierto» por el cambio de 00:30. Además, la hora de levantarse propuesta es 07:00 en vez de 09:00. Una persona que acepte lo propuesto crea un horario solo de domingo y el sábado queda a 18° todo el día.
- Dónde: `SchedulePage.tsx:310-314`.
- Propuesta: ignorar los cambios de madrugada al calcular `covered` (o atribuirlos al día anterior, como en N-01).

**N-03. El modo ausencia se pierde al cerrar sesión o desde otro móvil, y deja el horario desactivado para siempre.**
- Pasos: Casa → Me voy unos días → Activar. Ajustes → Cerrar sesión (el aviso dice «Tu calefacción y su horario seguirán funcionando igual»). Volver a entrar.
- Qué pasa: no hay banner «Ya he vuelto»; las tarjetas dicen «Sin horario» y todos los cambios aparecen «Desactivado» (`34-ausencia-tras-cerrar-sesion.png`, `35-…-horario.png`). La lista de qué cambios estaban activos y las temperaturas anteriores estaban solo en el almacenamiento local (`AwayState` en `controller.ts`; `signOut` pone `away: undefined`, ≈l.209-230). Pasa lo mismo en el móvil de otro miembro de la familia, que nunca ve el banner, o si se reinstala la app. En una instalación real, las zonas se quedarían a 16° y sin horario indefinidamente.
- Propuesta: guardar el estado de ausencia en la nube (por ejemplo, un fichero propio por FTP junto a `chronos.data`, o al menos detectar «todos los cambios desactivados» y ofrecer «Reactivar todo el horario»). Al cerrar sesión con la ausencia activa, avisar y pedir confirmación. En Ajustes, el texto de cerrar sesión no debe decir que todo sigue igual si hay ausencia.

**N-04. Al límite de 30, la opción por defecto «Solo <zona>» falla con un error seco.**
- Pasos: con 30 de 30 y un cambio compartido, en Dormitorio subir medio grado → Guardar (con «Solo Dormitorio» marcado por defecto), o tocar el interruptor de esa fila.
- Qué pasa: aviso «Máximo 30 cambios programados» y nada más (`28-limite-toggle-compartido.png`, `29-limite-editar-solo-zona.png`). No explica que dividir el cambio ocupa uno más, ni que «En todas» sí funcionaría.
- Dónde: `controller.ts` `saveSchedule` (el `catch` de `serializeSchedule`); `SchedulePage.tsx` `EventEditor`.
- Propuesta: en el editor, si `shared && events.length >= 30`, mostrar dentro de `ScopeChoice` «Para cambiarlo solo en Dormitorio hace falta un hueco libre (tienes 30 de 30). Puedes aplicarlo en todas o borrar otro cambio», y desactivar «Solo…». Para el interruptor, el mismo mensaje en un panel.

**N-05. Durante la ausencia la app dice «Sin horario» y deja reactivar cambios sueltos.**
- Qué pasa: las tres tarjetas de Casa ponen «Sin horario» (`31-ausencia-casa.png`), lo que asusta («¿he perdido el horario?»). En Horario, los interruptores de cada cambio siguen activos (`log:ausencia.interruptoresHabilitados`). Si se reactiva uno, el horario corre en plena ausencia. Al volver, `endAway` empareja por «firma» (días, hora, zonas, temperatura), así que cualquier edición durante la ausencia hace que ese cambio no se restaure.
- Dónde: `Home.tsx` `NextChange`; `SchedulePage.tsx` (no mira `s.away`); `controller.ts` `endAway`.
- Propuesta: con la ausencia activa, mostrar «En pausa (modo ausencia)» en la tarjeta y bloquear la edición del horario con un aviso «Pulsa Ya he vuelto para editar el horario». Restaurar por id además de por firma.

**N-06. Desactivar y reactivar un cambio compartido lo desenlaza para siempre y gasta huecos.**
- Pasos: Salón y Dormitorio comparten 23:00 → en Salón, interruptor apagado → encendido.
- Qué pasa: quedan dos registros idénticos «Solo esta zona» (`log:fila.trasReactivar.salon`) y el contador pasa de 7 a 8. La próxima edición desde una zona ya no afecta a la otra y no se avisa. Con unos cuantos encendidos y apagados se llega antes a 30.
- Dónde: `core/schedule.ts` `applyEdit`/`compact` (no se fusionan registros iguales).
- Propuesta: en `compact`, fusionar los eventos con mismos días, minuto, temperatura y estado (unir zonas). Eso además devuelve los huecos.

**N-07. Con texto grande, los interruptores de Horario quedan fuera de la pantalla.**
- Evidencia: `52-horario-texto-200.png` (scrollWidth 499 en 390). La fila `.event` no se ajusta: hora, días, temperatura e interruptor siguen en una línea. Casa también desborda (438) por el selector Calefacción/Refrigeración.
- Propuesta: `flex-wrap` en `.event` o poner la temperatura y el interruptor debajo; `flex-wrap` en `.segmented`; pestañas de zona con scroll horizontal visible o en varias líneas.

### P2

- **N-08.** «Olvidé la contraseña» propone en primer lugar crear otra cuenta para el mismo TermoWifi (`CreateAccount.tsx` `ForgotPassword`). Invertir el orden: primero el servicio técnico o el instalador, explicando el riesgo de tener dos cuentas.
- **N-09.** El aviso de fallo «Pulsa «Guardar» para reintentarlo» sale también tras el interruptor de fila y los botones de conflicto (`45-fallo-interruptor.png`; `controller.ts` `saveSchedule`). El texto debe depender del origen, o mejor ofrecer un botón «Reintentar» en el propio aviso.
- **N-10.** No hay indicador permanente de «guardado, pendiente de aplicar» (`scheduleSyncPending`) ni confirmación cuando se aplica tras reconectar. Mostrar una línea en Horario mientras `scheduleSyncPending` sea true.
- **N-11.** Sin conexión, la ficha de zona y la pantalla de Horario no muestran el estado ni bloquean (`41`, `42-*.png`). Los controles de Casa bloqueados solo con `pointer-events` siguen accionables con teclado o TalkBack. Usar `disabled`/`aria-disabled` y el mismo banner en todas las pantallas.
- **N-12.** Contraste: el botón flotante «Añadir cambio» tiene 3,58:1 en claro y 2,6:1 en oscuro (`log:a11y.contraste.*.horario`), y «Conectado» sigue a 3,87:1. Usar `--heat-text` (#c2410c) de fondo en el botón y oscurecer `--ok` en la pastilla.
- **N-13.** Los avisos (abajo, fijos) tapan campos de los paneles: «Me acuesto a las» en `16-rapido-finde-avisos.png` y los chips de días en `19-editar-compartido.png`. Con dos guardados seguidos se apilan dos avisos iguales (`log:toast.guardado`). Colocarlos arriba cuando hay un panel abierto y no repetir el mismo texto.
- **N-14.** Tras cerrar sesión y volver a entrar, la app abre en la pestaña «Ajustes» (`log:ausencia.trasCerrarSesion.pestanaInicial`). Hay que reiniciar a «Casa» en `signOut`/`signIn` (`App.tsx` mantiene `tab`).
- **N-15.** Errata «Se mantiene lo de de lunes a viernes» (`SchedulePage.tsx:352`: «lo de {describeDays(...)}» con «De lunes a viernes» en minúscula). «Sustituye lo que ya había: sáb.» usa abreviatura; mejor «el sábado».
- **N-16.** Al volver de la ausencia se restauran las temperaturas del momento de irse (p. ej. 21° de un viernes por la tarde) aunque sea de madrugada. Sería mejor aplicar la que toca según el horario («Ahora, según el horario»).
- **N-17.** Vista semanal: «hasta las 24:00» cuando la temperatura continúa al día siguiente; la marca de «ahora» cruza el número del tramo; los tramos de menos de ~1 h son invisibles (la madrugada de 00:00–00:30 a 21° de N-01 no se ve).

---

## 3. Casos de planificación de las personas, de extremo a extremo

**P-a. Vecina de 75 años: subir el salón y que baje por la noche.**
Subir con «+» en la tarjeta funciona igual que antes. Su horario de L-V ya existe en la demo. La tarjeta dice ahora correctamente «Próximo: 21,0° el lunes a las 07:00» (`06`). Si se acuesta a las 00:30, el asistente ya la deja (`13`). Lo que **no** ve en la tarjeta es hasta cuándo dura su subida manual: eso está en «Detalles» (`07`). Y si se va unos días y luego un familiar cierra la sesión o lo mira desde otro móvil, se queda sin horario (N-03).
→ **Lo conseguiría sin ayuda en el caso básico (solo laborables).** Con texto grande se le corta la pantalla de Horario (N-07), algo muy probable a esa edad.

**P-b. Familia: laborables + fin de semana + despacho solo laborables.**
Con horas «normales» (acostarse antes de las 00:00) funciona: el asistente propone S-D tras L-V y avisa de lo que mantiene. **Con acostarse después de medianoche, el caso falla**: el asistente preselecciona solo domingo (N-02) y, aunque se elija «Fin de semana», la noche del viernes queda a 21° hasta las 09:30 del sábado (N-01), mientras el asistente afirma que «se mantiene lo de lunes a viernes». La familia no lo notará en la app (el tramo de madrugada ni se ve en la vista semanal, N-17); lo notará en la factura o en el calor de la noche.
→ **No: el resultado es incorrecto sin ningún aviso.** Es el problema más grave de esta revisión.

**P-c. Usuario avanzado.**
Edición con alcance por zona, interruptor en cada fila, conflictos con «¿con cuál te quedas?», hora libre propuesta, límite de 30 explicado y modo ausencia: el control fino es ahora bueno. Pegas para él: dividir al límite da «Máximo 30 cambios programados» (N-04); encender y apagar desenlaza zonas y gasta huecos (N-06); no hay aviso previo de conflicto ni duplicar cambio; no hay indicador de «pendiente de aplicar» (N-10).
→ **Sí, lo consigue**, con molestias.

**¿Lo conseguiría ahora una persona mayor sin ayuda?** Para el caso típico (un horario de laborables, subir o bajar, apagar), **sí**: los textos son claros, «Próximo» ya es fiable, las confirmaciones están separadas y cerrar sin guardar pregunta. **No** para un horario con madrugada combinado con fin de semana (N-01/N-02), ni para usar el modo ausencia en una casa con más de un móvil (N-03). Con texto grande del sistema, la pantalla de Horario sigue sin caber (N-07). Mientras N-01 y N-03 no estén arreglados, no recomendaría darla por cerrada.

---

## 4. Notas

- Errores de consola en todos los recorridos: ninguno (`log:errors.*`).
- No se ha usado la nube real ni credenciales reales. Siguen vigentes los riesgos del apartado 4 del primer informe, sobre todo qué gana en un conflicto en la nube y el cambio de hora del 25-10-2026, con fechas guardadas de «hoy» en `chronos.data`.
