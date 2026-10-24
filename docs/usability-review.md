# Revisión crítica de usabilidad — TermoZona (modo demostración)

Fecha: 24-10-2026 (sábado, ~11:30 hora de Madrid). Revisado en http://127.0.0.1:5391/ con Playwright (viewport 390×844, `es-ES`, `Europe/Madrid`) y leyendo `app/src/`.

Evidencia en `docs/review-evidence/`:
- `review.mjs`: script reproducible (`node docs/review-evidence/review.mjs`).
- `review-log.json` y `run.log`: textos de pantalla capturados en cada paso.
- `aria-home.txt` y `aria-horario.txt`: árbol de accesibilidad.
- `NN-*.png`: capturas.

> Nota: otro agente estaba modificando `app/` durante la revisión, así que las líneas de código citadas corresponden al estado del 24-10 por la mañana. Durante la revisión el coordinador corrigió dos cosas del simulador: la rama «Es mío, continuar» (antes siempre fallaba en la demo) y la superposición del botón «Añadir cambio». Las dos se volvieron a probar con el código corregido.
>
> Las capturas son `fullPage`, por lo que los elementos fijos (barra de pestañas, avisos, botón flotante) aparecen a media página. Eso es un efecto de la captura, no un fallo de la app.

Leyenda: ✅ funciona y es intuitivo · ⚠️ funciona pero confunde · ❌ falla / no se puede hacer.

---

## 1. Matriz de casos de uso

### 1.1 Personas

| # | Caso | Resultado | Evidencia / comentario |
|---|------|-----------|------------------------|
| P-a | **Vecina de 75 años**: subir la calefacción del salón y que por la noche baje | ⚠️ | Subir es inmediato: el «+» de la tarjeta, que pasa a «Enviando» (`31-home-subir-pending.png`). Para que baje por la noche tiene que ir a *Horario → Crear horario rápido* y entender «Me levanto / Me acuesto / Confort / Ahorro» (`42-rapido-default.png`), lo cual es razonable. El problema es lo que ve después: en la tarjeta pone «Próximo: 21,0° a las 07:00 (**mañana**)» un sábado, cuando el cambio es el **lunes** (bug H-05). Además, si se acuesta después de las 00:00 el asistente no la deja guardar (H-03). Tampoco se le avisa de que su subida manual se perderá en el siguiente cambio programado. |
| P-b | **Familia**: horario distinto entre semana y fin de semana, más un despacho solo laborables | ⚠️ | Se consigue. Despacho con salida de casa en laborables (`45-despacho-con-horario.png`). Fin de semana del salón con «Rehacer con horario rápido» cambiando los días (`46-rapido-finde.png`, `47-salon-semana-finde.png`). Pero el botón se llama «**Rehacer**», lo que da a entender que borra todo, y por defecto marca L-V: si no cambias los días, sobrescribes los laborables. Acostarse a las 00:30 el sábado es imposible (H-03); tuve que poner 23:59. |
| P-c | **Usuario avanzado**: control fino | ⚠️ | El editor de cambios es completo: hora, temperatura, días, zonas y activo (`52-nuevo-cambio.png`). Faltan cosas: un aviso claro al editar o borrar cambios compartidos (H-01), ver qué cambio gana en un conflicto (H-04), duplicar un cambio, un modo ausencia (H-06) y ver la temperatura exacta en la vista semanal (H-07). |

### 1.2 Planificación (prioridad máxima)

| # | Caso | Resultado | Evidencia / comentario |
|---|------|-----------|------------------------|
| S-01 | Crear horario rápido de laborables | ✅ | `41-horario-despacho-vacio.png`, `42-rapido-default.png` y `45-despacho-con-horario.png`. El estado vacío explica qué hacer y el asistente muestra un resumen. Guarda 4 cambios y avisa con «Programación guardada en la nube». |
| S-02 | Horario distinto de fin de semana para la misma zona | ⚠️ | Funciona (`47-salon-semana-finde.png`), pero solo si se descubre que «Rehacer con horario rápido» sirve para añadir y no solo para rehacer, y que hay que cambiar los días. Cuando no pisa nada no se avisa de que los laborables se conservan (`rapido.finde` vacío en el log), así que la persona no sabe si ha borrado lo anterior. |
| S-03 | Bloque «salgo de casa» | ✅ | El interruptor «Salgo de casa durante el día» añade «Salgo a las» y «Vuelvo a las» (`43-rapido-salgo.png`). Valida el orden de las horas. |
| S-04 | Copiar horario a otra zona | ✅/⚠️ | `48-copiar.png` y `49-tras-copiar.png`. Copiar no gasta cambios (8 de 30 antes y después), y eso está muy bien. Pero las dos zonas pasan a **compartir** los mismos cambios, y la consecuencia (H-01) no se explica en ese momento. |
| S-05 | Editar desde una zona un cambio compartido con otras | ❌ | Desde la pestaña Dormitorio cambié el de las 07:00 de 21° a 22°. El salón («Sala de estar») también pasó a 22° (`50-editar-compartido.png`, `51-salon-afectado-por-dormitorio.png`). El editor no dice que el cambio afecta a otra zona; solo lo deja adivinar por los chips de zona marcados. En la lista aparece «También en Dormitorio» en gris pequeño. → **H-01 (P0)** |
| S-06 | Borrar | ❌ | Borré el cambio de las 07:00 L-V desde Sala de estar y **también desapareció del Dormitorio** (`55-borrar-confirm.png`, `56-tras-borrar-dormitorio.png`). La confirmación («Sí, borrar este cambio») no menciona las demás zonas. → H-01 |
| S-07 | Desactivar | ⚠️ | El interruptor «Activo» dentro del editor funciona y la lista muestra «Desactivado ·» (`54-desactivado.png`). Pero para hacerlo hay que abrir, cambiar y guardar, uno a uno. Si el cambio es compartido, desactiva todas sus zonas (H-01). |
| S-08 | Conflictos (misma hora y día, temperaturas distintas) | ⚠️ | Se detectan y se avisa (`53-conflicto.png`), lo cual está bien. Problemas: el texto dice «Hay **5 cambios** que chocan» cuando son **2 cambios** que chocan **5 días**; los cambios en conflicto no se resaltan en la lista; no se sabe cuál ganará en la nube; la vista semanal pinta uno de los dos sin decirlo. Además, el valor por defecto de «Añadir cambio» (07:00, todos los días, 21°) choca con el horario rápido estándar (07:00). → H-04 |
| S-09 | Llegar al límite de 30 | ⚠️ | El contador «30 de 30 cambios» se ve, pero el botón «Añadir cambio» **desaparece sin explicación** (`57-limite-30.png`). El asistente rápido sí explica el límite (`58-limite-rapido.png`), aunque su consejo («Usa menos zonas o copia el horario entre zonas») no sirve a quien ya está en 30; lo útil sería «borra cambios». → H-08 |
| S-10 | Saber qué temperatura habrá a una hora concreta | ⚠️ | La vista semanal es una buena idea (`40-horario-salon.png`). Pero 20,5°, 21° y 22° tienen colores casi iguales (`53-conflicto.png`), no hay eje con horas intermedias y en el móvil no hay nada que tocar para ver el valor: solo existe un `title`, que no funciona con el dedo. Los lectores de pantalla sí tienen el detalle (`aria-horario.txt`). → H-07 |
| S-11 | Entender que el horario no enciende zonas apagadas | ⚠️ | Se dice en tres sitios (Horario, ficha de zona y Ajustes). Pero la tarjeta de una zona **apagada** sigue anunciando «Próximo: 21,0° a las 07:00» (`34-home-todas-apagadas.png`), lo que invita a pensar que a esa hora se encenderá. → H-09 |
| S-12 | Horarios que cruzan medianoche | ❌ | En el horario rápido, poner «Me acuesto a las 00:30» bloquea el botón con «Las horas deben ir en orden…» (`44-rapido-medianoche.png`). Con el editor manual sí se puede crear un cambio a las 00:30, pero hay que marcar el día **siguiente** (el de la madrugada del sábado va en «sábado»), algo que nadie va a deducir. → H-03 |
| S-13 | Vacaciones o ausencia prolongada | ❌ | No existe. Las opciones son apagar todas las zonas, con riesgo de que la casa se enfríe demasiado, o desactivar a mano cada cambio (hasta 30 guardados) y acordarse de reactivarlos todos. → H-06 |
| S-14 | Recuperarse si falla el guardado | ⚠️ | No se puede provocar en la demo; lo he revisado en el código. El editor queda abierto con los datos, lo cual está bien, y aparece un aviso de 7 s. Pero el aviso dice «**No se ha cambiado nada**» aunque el fichero ya se haya subido y lo que falló fuera la orden de recarga por socket (`core/controller.ts:450-470`). Y si no hay socket, sube el fichero sin pedir la recarga y avisa de «guardado» igualmente. → H-10 |
| S-15 | Cerrar el editor sin guardar | ⚠️ | Escape o tocar fuera del panel **descarta los cambios sin preguntar** (`editor.escapeDescarta: true`; `components.tsx:79-86`). En un móvil es fácil tocar fuera sin querer. → H-14 |
| S-16 | Aviso tras guardar | ⚠️ | El aviso verde «Programación guardada en la nube» tapa el contenido del panel durante 4 s (`50-editar-compartido.png`). Con varios guardados seguidos se acumulan (`horario.salonFinde` en el log muestra dos avisos a la vez). |

### 1.3 Control diario

| # | Caso | Resultado | Evidencia / comentario |
|---|------|-----------|------------------------|
| D-01 | Subir o bajar la temperatura | ✅ | Botones grandes de 48 px. El valor se muestra atenuado hasta que el termostato lo confirma (`31-home-subir-pending.png`). Pasos de 0,5 dentro de 15–35. |
| D-02 | Encender o apagar una zona | ✅/⚠️ | El interruptor funciona (`32-home-despacho-off.png`), pero mide 64×36 px, por debajo de 44–48 px de alto (H-12). Al encender Despacho a 19°, con 19° en la sala, pone «Temperatura alcanzada»: es correcto, pero no confirma que la zona se haya encendido. |
| D-03 | Apagar todas | ✅ | Pide confirmación con un texto claro (`33-home-apagar-todas.png`) y después ofrece «Encender todas las zonas» (`34-home-todas-apagadas.png`). |
| D-04 | Cambiar calor/frío | ✅ | Pide confirmación, explica que el modo es común a toda la casa y avisa de la condensación (`35-home-modo-confirm.png`, `36-home-modo-frio.png`). |
| D-05 | Renombrar zona | ⚠️ | Funciona (`38-zona-renombrar.png`), pero «Solo se cambia en este móvil». En una familia, cada móvil verá nombres distintos, también en el horario. El botón está al final de la ficha, lejos de donde se mira. |
| D-06 | Entender «Calentando» y «Temperatura alcanzada» | ✅/⚠️ | Los textos son claros y tienen icono. En frío pone «Enfriando». Falta explicar por qué una zona encendida a 19° con 19,5° en la sala «no calienta», que es la duda típica con suelo radiante por su inercia. |
| D-07 | Sin conexión | ⚠️ | No se puede simular en la demo (el simulador vive en memoria); lo he revisado en el código. Con datos en caché, las tarjetas siguen viéndose activas y solo la pastilla dice «Sin conexión · hace X». Al pulsar «+» sale un aviso de 4 s («Sin conexión… Reintentando») y no se aplica nada (`controller.ts:395-400`). Las temperaturas antiguas no se marcan como antiguas. → H-11 |
| D-08 | Ficha de zona | ✅ | Muestra preajustes Ahorro, Noche y Confort, humedad, modo, el horario de hoy y la aclaración de que el horario no enciende (`37-zona-detalle.png`). |

### 1.4 Alta de cuenta

| # | Caso | Resultado | Evidencia / comentario |
|---|------|-----------|------------------------|
| A-01 | Flujo completo | ✅ | Intro, Wi-Fi opcional, TermoWifi (con búsqueda), usuario, zonas y «¡Listo!» → Entrar (`10`–`22-*.png`). Muestra los pasos con «Paso N de 5». |
| A-02 | Usuario ya existente (`vecino`): pantalla | ✅ | Por fin dice claramente «El usuario «vecino» ya existe» y explica los dos motivos posibles (`15-alta-existe.png`). Es la mejora más importante frente a iDomus. |
| A-03 | Rama «Es mío, continuar» con contraseña correcta | ✅ | Creé `abuela`, salí a mitad de la búsqueda de zonas, repetí el alta y pulsé «Es mío»: retoma en «Tus zonas» (`23-alta-reanudar-esmio-ok.png`), con el simulador ya corregido. |
| A-04 | Rama «Es mío» con contraseña distinta | ❌ | El mensaje es «Ese nombre ya lo usa otra persona, o la contraseña no es la que pusiste entonces. **Elige otro nombre de usuario.**» (`16-alta-existe-esmio-error.png`). No hay forma de corregir la contraseña en esa pantalla ni opción «He olvidado la contraseña». La persona mayor que creó la cuenta con iDomus y no recuerda la contraseña acaba creando otra cuenta, y el TermoWifi queda asociado a dos. → H-02 |
| A-05 | Rama «Elegir otro nombre» | ✅ | Vacía el usuario y conserva la contraseña (`17-alta-otro-nombre.png`). |
| A-06 | Validaciones de usuario y contraseña | ✅/⚠️ | Los mensajes son claros (`14-alta-validaciones.png`), pero solo aparecen al pulsar «Crear cuenta». La ayuda («sin espacios ni tildes») ya se ve antes, eso está bien. «Vecino» con mayúscula se trata como existente en la demo (`18-alta-Vecino-mayus.png`); falta confirmar cómo se comporta el servidor real. |
| A-07 | Nombre del TermoWifi | ✅ | Búsqueda de redes y validación de «Ing_ + 6» con ejemplo (`12-alta-device-invalid.png`, `13-alta-device-ok.png`). |
| A-08 | Zonas encontradas y ponerles nombre | ⚠️ | Aparecen «Zona 1/2/3» con sugerencias (`19-alta-zonas.png`), pero **nada ayuda a saber qué habitación es la Zona 1**: ni la temperatura actual de cada zona ni una forma de identificarla. Una persona mayor pondrá los nombres al azar. → H-13 |
| A-09 | Conectar el TermoWifi a la Wi-Fi | ⚠️ | Las instrucciones son vagas: «consulta su manual: normalmente se mantiene pulsado su botón…» (`11-alta-wifi.png`). Además, en el navegador no se puede probar. |
| A-10 | Mensajes de error del alta | ✅ | Específicos para red, servidor (con código), usuario no válido y fallo al subir la configuración («Tu cuenta ya está creada: pulsa Guardar otra vez»). |

### 1.5 Inicio de sesión

| # | Caso | Resultado | Evidencia / comentario |
|---|------|-----------|------------------------|
| L-01 | Contraseña incorrecta | ⚠️ (por código) | En el navegador el botón «Entrar» está deshabilitado siempre (`02-login-web-disabled.png`), porque solo funciona la demo. El mensaje en el código es claro: «Usuario o contraseña incorrectos. Revisa mayúsculas y espacios.» (`core/cloud.ts:51`). |
| L-02 | Contraseña cambiada con la sesión abierta | ✅/⚠️ | Probado corrompiendo la sesión guardada: vuelve al login con «La contraseña ha cambiado. Vuelve a entrar.» (`60-sesion-pass-rota.png`). Puede no ser cierto (quizá la escribió mal en otro móvil), pero se entiende. |
| L-03 | Otros errores | ✅ | Hay textos específicos para cuenta bloqueada, TermoWifi desconectado, sin internet y servidor caído (`cloud.ts:50-58`). Ahora hay un botón «Mostrar» para ver la contraseña. |
| L-04 | Olvidé la contraseña | ❌ | No hay ninguna salida ni explicación de qué hacer. → H-02 |

### 1.6 Accesibilidad

| # | Caso | Resultado | Evidencia / comentario |
|---|------|-----------|------------------------|
| X-01 | Tamaños de toque | ⚠️ | Casi todo mide al menos 48 px. Quedan por debajo los interruptores (64×36) y la pastilla de conexión (114×32) (`a11y.smallTargets` en el log). → H-12 |
| X-02 | Contraste en claro | ⚠️ | No llegan a 4,5:1 «Calefacción» y «Calentando» (naranja #e8590c sobre blanco, 3,58:1), «Detalles» (4,2:1), las pestañas inactivas «Horario» y «Ajustes» (3,66:1) y «Conectado» (3,87:1) (`a11y.contrasteClaro`). → H-12 |
| X-03 | Contraste en oscuro | ✅ | No hay textos por debajo de 4,5:1 (`a11y.contrasteOscuro: []`, `70-home-oscuro.png`, `71-horario-oscuro.png`). |
| X-04 | Lectores de pantalla | ✅/⚠️ | Hay buenos roles y nombres: `switch "Salón: encendida"`, grupos «Temperatura deseada en Salón», paneles `dialog aria-modal`, `tablist` y una vista semanal descrita con `img` y su texto (`aria-home.txt`, `aria-horario.txt`). Defectos: el valor de los tres reguladores es `aria-live`, así que cualquier actualización de la nube se anuncia; los botones dicen «Subir medio grado» sin la zona (está en el grupo); las pestañas usan a la vez `aria-selected` y `aria-pressed`, sin `tabpanel`. |
| X-05 | Texto grande (200 %) | ❌ | Con la fuente al doble, la página se desborda en horizontal (`scrollWidth` 506 en un viewport de 390), «Mi casa» se parte en dos líneas y los reguladores quedan apretados y cortados (`72-home-texto-200.png`, `73-horario-texto-200.png`, `74-editor-texto-200.png`). Es justo lo que usa una persona mayor. → H-12 |

**Total: 46 casos evaluados** (3 personas, 16 de planificación, 8 de control diario, 10 de alta, 4 de inicio de sesión y 5 de accesibilidad).

---

## 2. Hallazgos priorizados

### P0 — bloquean o causan daño silencioso

**H-01. Editar, desactivar o borrar un cambio compartido afecta sin avisar a otras zonas.**
- Pasos: Horario → Salón → «Copiar a otras zonas» → Dormitorio. Después, en la pestaña Dormitorio, tocar el cambio de las 07:00, subir a 22° y guardar. En la pestaña Salón también pone 22°. Igual al borrar desde Salón: desaparece del Dormitorio.
- Esperado: al estar en la pestaña «Dormitorio», lo que toco afecta al Dormitorio. Si afecta a más zonas, me lo dicen claramente y me dejan elegir.
- Qué pasa: se modifica o borra el registro compartido sin avisar. La única pista es «También en Dormitorio» en gris pequeño en la lista. Evidencia: `50-editar-compartido.png`, `51-salon-afectado-por-dormitorio.png`, `56-tras-borrar-dormitorio.png`.
- Dónde: `ui/SchedulePage.tsx` `EventEditor` (≈l.138-196), `onDelete`/`onSave` (≈l.450-451).
- Propuesta: si `ev.zones.length > 1`, mostrar arriba del editor un aviso «Este cambio también se aplica a: Salón» y, al guardar o borrar, preguntar «¿Solo en Dormitorio» o «En todas (Dormitorio y Salón)»? «Solo en esta zona» se implementa separando el registro: quitar la zona del original y crear uno nuevo solo con ella, avisando si eso supera los 30. Para borrar, por defecto «Quitar de esta zona», que equivale a quitar la zona del registro. En el copiado, explicar que «Las zonas quedan enlazadas: lo que cambies en una se cambia en todas».

### P1 — importantes

**H-02. Contraseña olvidada o distinta: no hay salida, y la app empuja a crear otra cuenta.**
- Pasos: Alta → usuario `vecino` → «Es mío, continuar» con otra contraseña.
- Qué pasa: «…Elige otro nombre de usuario.» No hay campo para reintentar la contraseña en esa pantalla ni ayuda en el login (`16-alta-existe-esmio-error.png`; `ui/CreateAccount.tsx` ≈l.168-171).
- Propuesta: en la pantalla «ya existe», añadir un campo de contraseña dentro de la tarjeta «Es mío» para reintentar ahí mismo. Si falla, separar los dos mensajes: «La contraseña no coincide. Prueba otra vez» y «Si no la recuerdas: …» (explicar el procedimiento real de Orkli o el soporte del instalador). No sugerir crear otro usuario como primera opción. Añadir «¿Has olvidado la contraseña?» en el login.

**H-03. Imposible acostarse después de medianoche en el horario rápido.**
- Pasos: Horario rápido → «Me acuesto a las» 00:30.
- Qué pasa: aviso «Las horas deben ir en orden…» y botón deshabilitado (`44-rapido-medianoche.png`; `SchedulePage.tsx` ≈l.216-217, 225).
- Propuesta: aceptar una hora de acostarse menor que la de levantarse como «del día siguiente», con el texto «00:30 (madrugada del día siguiente)». Generar el cambio con los días desplazados uno (L-V → M-S). Hacer lo mismo en el editor manual: si la hora es antes de las 05:00, mostrar «madrugada de…» junto a los días.

**H-04. Los conflictos se explican mal.**
- Pasos: con el horario de las 07:00 L-V, añadir un cambio (por defecto 07:00, todos los días) a 20,5°.
- Qué pasa: «Hay 5 cambios que chocan…» (son 2 cambios en 5 días). No se resaltan en la lista y no se sabe cuál gana (`53-conflicto.png`; `SchedulePage.tsx` ≈l.378-384).
- Propuesta: el texto debería ser «Dos cambios piden temperaturas distintas a las 07:00 (lunes a viernes): 22° y 20,5°». Marcar las dos filas con un borde de aviso y ofrecer «Quedarme con 22°» o «Quedarme con 20,5°». Para evitarlos, que «Añadir cambio» proponga una hora libre o avise antes de guardar si va a chocar.

**H-05. «Próximo: … (mañana)» indica un día equivocado.**
- Pasos: un sábado a las 11:16, con el horario L-V del salón.
- Qué pasa: «Próximo: 21,0° a las 07:00 (mañana)», cuando el cambio es el lunes (`30-home.png`). `formatIn` llama «mañana» a cualquier cosa entre 24 y 48 h (`ui/components.tsx` ≈l.222-228).
- Propuesta: usar el día real del calendario: «hoy a las 23:00», «mañana a las 07:00», «el lunes a las 07:00».

**H-06. No hay modo vacaciones o ausencia.**
- Hoy, para irse 10 días, hay que desactivar cada cambio a mano y luego reactivarlos todos, o apagar todas las zonas (riesgo de que la casa se enfríe demasiado y de olvidar encenderla).
- Propuesta: un botón en Casa «Me voy unos días» que pida fecha de vuelta y temperatura de mantenimiento (p. ej. 16°). La app pone esa temperatura en todas las zonas y guarda el horario con los cambios desactivados, recordando cuáles estaban activos. Al volver, o con un botón «Ya he vuelto», los restaura. Hay que dejar claro que la vuelta automática no la ejecuta la nube: depende de que alguien abra la app. Alternativa sin depender del móvil: desactivar los cambios y añadir uno de «vuelta», aunque el formato no admite fechas. Este riesgo debe validarse con la instalación real.

**H-07. La vista semanal no permite saber la temperatura a una hora concreta.**
- Qué pasa: los colores de 20,5°, 21° y 22° son casi iguales (`53-conflicto.png`); solo hay marcas a 0, 6, 12, 18 y 24 h; el `title` no funciona en el móvil (`SchedulePage.tsx` ≈l.73-78, 106).
- Propuesta: escribir la temperatura dentro de cada tramo cuando quepa. Al tocar un día, mostrar la lista de franjas de ese día («00:00–07:00 18°, 07:00–23:00 21°…»). Añadir una línea «Ahora: 21° hasta las 23:00» encima de la vista.

**H-08. Al llegar a 30 cambios el botón «Añadir cambio» desaparece sin explicación.**
- Evidencia: `57-limite-30.png`, `58-limite-rapido.png`; `SchedulePage.tsx` ≈l.437-441.
- Propuesta: mantener el botón y, al pulsarlo, explicar «Has llegado al máximo de 30 cambios que admite Orkli. Borra o agrupa cambios…». Sugerir unir automáticamente cambios idénticos de distintas zonas o días, que ya se hace al copiar.

**H-09. Las zonas apagadas anuncian «Próximo: 21° a las 07:00».**
- Evidencia: `34-home-todas-apagadas.png`; `ui/Home.tsx` ≈l.111.
- Propuesta: con la zona apagada, mostrar «Apagada — el horario no la encenderá» o atenuar el texto añadiendo «(si la enciendes)».

**H-10. El mensaje de fallo al guardar puede ser falso, y sin socket se avisa de un éxito dudoso.**
- Dónde: `core/controller.ts` `saveSchedule` (≈l.450-470). Si la subida FTP funciona pero falla el `send` de recarga, el aviso dice «No se ha cambiado nada». Si no hay socket, sube el fichero sin pedir la recarga y avisa de éxito.
- Propuesta: separar los dos pasos. «Guardado, pero la nube aún no lo ha aplicado; lo reintentaremos» y reintentar la recarga al reconectar. En el fallo real de subida, ofrecer un botón «Reintentar» dentro del editor, no solo un aviso de 7 s.

**H-11. Sin conexión, los datos antiguos parecen actuales y los botones parecen funcionar.**
- Dónde: `ui/Home.tsx` (la tarjeta de error solo aparece si no hay datos) y `controller.ts:395-400`.
- Propuesta: con `link !== 'online'`, mostrar arriba un aviso fijo («Sin conexión desde hace 12 min. Los datos pueden no estar al día») y atenuar o deshabilitar los reguladores, explicando el motivo, en lugar de un aviso pasajero de 4 s.

**H-12. Accesibilidad para mayores: texto grande, contraste y tamaño de los interruptores.**
- Texto al 200 %: desbordamiento horizontal y reguladores cortados (`72`–`74-*.png`). Conviene pasar la tarjeta de zona a una columna (lectura arriba, regulador abajo) cuando no quepa, por ejemplo con `flex-wrap` o una `@container` query.
- Contraste: oscurecer el naranja para texto (p. ej. #c2410c, ≈5:1), «Detalles» (#1864ab) y `--text-3` en las pestañas (#5f6b77). Ver X-02.
- Interruptores: al menos 48 px de alto de zona táctil (64×36 ahora; `index.css` ≈l.480-484). Pastilla de conexión: al menos 44 px.
- Avisos: 4 s es poco para leer. Usar 6–8 s, o mantenerlos en pantalla hasta que se cierren en el caso de los errores.

**H-13. En el alta no hay forma de saber qué habitación es cada «Zona N».**
- Evidencia: `19-alta-zonas.png`; `ui/CreateAccount.tsx` ≈l.391-404.
- Propuesta: mostrar la temperatura actual de cada zona («Zona 1 — ahora 20,5°»). Añadir un botón «Identificar» que suba temporalmente la temperatura deseada de esa zona para que el termostato físico lo muestre, o indicar «mira el número en la pantalla del termostato». Avisar de que los nombres se pueden cambiar después.

### P2 — mejoras

- **H-14.** Escape o tocar fuera del panel descarta los cambios sin preguntar (`components.tsx` ≈l.79-86). Preguntar «¿Descartar los cambios?» si hay cambios sin guardar.
- **H-15.** El botón «Rehacer con horario rápido» confunde. Llamarlo «Horario rápido (añadir o cambiar días)» y preseleccionar los días que la zona **aún no** tiene cubiertos (p. ej. S-D si ya tiene L-V). Cuando no se sustituye nada, decir «Se mantiene lo de lunes a viernes».
- **H-16.** El aviso de borrar y la confirmación están en el mismo sitio: dos toques rápidos borran. Poner la confirmación en un diálogo aparte o en otra posición.
- **H-17.** Los nombres de zona solo existen en el móvil donde se pusieron (`ZoneSheet.tsx` ≈l.100). Si es viable, guardarlos en `Instal.dat` (ya lo sube el alta), o al menos avisar de «otros móviles verán otro nombre».
- **H-18.** Las zonas se ordenan alfabéticamente como texto: `.sort()` sin comparador (`SchedulePage.tsx:61`, `CreateAccount.tsx:125`). Con 10 o más zonas, la zona 10 va antes que la 2. Usar `.sort((a, b) => a - b)`.
- **H-19.** El cambio manual no avisa de que el horario lo pisará. Tras tocar «+», mostrar «21,5° hasta las 23:00 (luego 18°, según tu horario)».
- **H-20.** Las instrucciones de Wi-Fi del alta son vagas («consulta su manual»). Añadir foto o esquema del botón del TermoWifi y del LED esperado.
- **H-21.** Lectores de pantalla: quitar `aria-live` del valor de los reguladores de Casa, o anunciar solo los cambios que hace el usuario. Añadir la zona a los botones («Subir Salón medio grado»). Quitar `aria-pressed` de las pestañas.
- **H-22.** Los cambios desactivados no se ven en la vista semanal (correcto), pero no hay forma rápida de activarlos o desactivarlos desde la lista. Añadir un interruptor en cada fila.

---

## 3. Lo que funciona bien

- **Usuario existente**: la pantalla «El usuario «vecino» ya existe» con dos caminos es exactamente lo que faltaba en iDomus. Además retoma un alta a medias (`15`, `23-*.png`).
- **Pantalla principal tipo Home Assistant**: en cada tarjeta se ven la temperatura actual y la deseada, si está encendida, si está calentando y el próximo cambio. Los botones son grandes y el valor aparece atenuado mientras se envía.
- **Horario rápido**: en una sola pantalla se pregunta por la rutina, se muestra un resumen, se avisa de lo que se sustituye y del límite de 30. Copiar entre zonas no gasta cambios.
- **Confirmaciones en las acciones peligrosas**: cambiar el modo de toda la casa (con aviso de condensación) y apagar todas las zonas.
- **Mensajes claros**: los de login y alta son específicos y en lenguaje llano. Se recuerda en varios sitios que el horario no enciende zonas.
- El **modo oscuro** pasa las comprobaciones de contraste. El árbol de accesibilidad es razonable. No hubo errores de consola en todo el recorrido (`errors: []`).

## 4. Riesgos que solo se pueden validar con la instalación real

1. **Qué cambio gana en un conflicto** en la nube de Orkli (el primero del fichero, el último o ninguno), y si la nube ejecuta bien varios cambios a la misma hora.
2. **Hora de los cambios y horario de verano**: `serializeSchedule` guarda la fecha y hora de *hoy* para cada cambio con una línea `TZ:`. Hay que comprobar que la nube respeta la hora local tras el cambio de hora (25-10-2026, mañana mismo) y que la app oficial lee igual ese fichero.
3. **La orden de recarga del horario** (`send(12,0,122,254)` / `send(255,255,122,254)`): confirmar que es necesaria y suficiente, y qué pasa si se sube el fichero sin enviarla (caso sin socket, H-10).
4. **Inercia del suelo radiante**: los avisos de «Calentando» y «Temperatura alcanzada» y los 12 s de espera de confirmación pueden ser poco realistas. Hay que comprobar cuánto tarda el TermoWifi real en confirmar y si salen avisos falsos de «no ha confirmado el cambio».
5. **Alta real**: los códigos del servidor (`Error(-1)`, `Error(-2)`), si el usuario distingue mayúsculas y minúsculas, el login con una cuenta a medias de iDomus, la búsqueda de zonas (duración y zonas «fantasma») y el aprovisionamiento Wi-Fi desde Android.
6. **Convivencia con iDomus**: si alguien edita el horario en la app oficial, que TermoZona no pierda cambios ni IDs (hoy los IDs se regeneran en cada lectura) y viceversa. Que los nombres locales no choquen con `Instal.dat`.
7. **Comportamiento sin conexión real**: reconexión con backoff, renovación del token y lo que se ve tras horas en segundo plano en Android.
8. **Texto grande en Android**: comprobar con el ajuste del sistema «Tamaño de fuente» al máximo en el WebView de Capacitor. Aquí se simuló cambiando el `font-size` raíz.
9. **Modo frío y punto de rocío**: el aviso y la limitación dependen de registros que la demo no simula.
