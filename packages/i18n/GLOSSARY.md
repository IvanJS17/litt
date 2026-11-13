# Glosario de la interfaz (es-MX)

> **Estado: aprobado por Iván el 2026-11-07.** Lo puede ajustar cuando lo vea en
> pantalla; un cambio de término se aplica en los dos catálogos y en esta tabla.

Términos fijos para traducir la interfaz de LiTT del inglés (`messages/en-US.json`,
la fuente) al español de México (`messages/es-MX.json`). Un término se traduce
siempre igual en la web y en Word.

## Trato

Se trata al usuario de **tú** («Guarda tus cambios», «Elige tu idioma»), como ya
hacen las piezas propias de LiTT. No se usa «usted».

## Estilo

Reglas cortas, sacadas de lo que ya hace el catálogo:

- Verbos directos de trato «tú»: «Escribe», no «Ingresa»; «Pide», no «Solicita».
- Pretérito simple, no perfecto compuesto: «expiró», no «ha expirado».
- Sin calcos del inglés: nada de «proporcionada» («la información que diste») ni de «en su lugar» cuando solo calca *in place* o *instead* y sobra. Un uso legítimo sí se queda: «No se usa otra llave en su lugar».
- «app», no «aplicación» («tu app de autenticación», «la app web»). «Aplicación» solo dentro de un nombre propio.
- Quitar algo sin borrarlo para siempre es «Quita» / «Quitar» (*Remove*): «Quita uno primero», «Quitar el criterio». «Borra» / «Borrar» y «Elimina» / «Eliminar» (*Delete*) solo cuando se borra para siempre. Como ya hace el catálogo: «Borrar» para un elemento que el usuario creó (un caso, un borrador); «Eliminar» para la cuenta, un usuario o un comprobante («usuario eliminado», «comprobante de eliminación»).
- «correo» basta cuando el contexto es claro; no se repite «correo electrónico» en cada mensaje.
- «verificación en dos pasos», no «verificación de dos factores».
- Frases cortas.
- Elipsis: … (un carácter).

## Términos

| Inglés | Español (es-MX) | Nota |
|---|---|---|
| matter | asunto | Plural: asuntos. |
| workspace | espacio de trabajo | |
| tabular review | revisión tabular | |
| playbook | playbook | Se queda en inglés; plural: playbooks. |
| workflow | flujo de trabajo | |
| BYOK (bring your own key) | Mis llaves | La interfaz nunca dice «BYOK» ni «llaves propias (BYOK)»; son «Mis llaves» (las de cada persona) y «Llaves del despacho». |
| organization | despacho | Un solo nombre en la interfaz: «despacho», no «organización» (Ajustes → Despachos, «Salir del despacho»). Solo cambian las etiquetas, nunca las claves ni los identificadores. Los Términos y el Aviso de privacidad son textos legales y no se tocan. |
| firm | despacho | Igual que *organization*. |
| add-in (Word) | complemento | «el complemento de Word». |
| add-ons (flujos de trabajo) | extensiones | Femenino: «las extensiones». No confundir con el complemento de Word. |
| snapshot (de un flujo) | versión publicada | |
| tracked changes / redline (la función) | control de cambios | |
| tracked change (cada cambio) | cambio marcado | Plural: cambios marcados. Nunca «cambio de control de cambios». |
| Personal (workspace) | Personal | Es el nombre del espacio de trabajo y se queda así. |
| deployment key | Llave de la plataforma | Nombre aprobado por el dueño (12-nov). La llave que ofrece la plataforma, no la de la persona ni la del despacho. |
| organization key | Llave del despacho | En los textos de llaves (chip del chat, selector, Ajustes) se dice «despacho», igual que en Ajustes → Llaves del despacho. |
| your own key | Mi llave | En el chip del chat y el selector: «Mi llave», «Llave del despacho», «Llave de la plataforma». |
| operator endpoint | modelo propio de la plataforma | El modelo que la plataforma sirve por su cuenta. |

## Lo que no se traduce

Contenido jurídico (playbooks, reglas, plantillas y fuentes), respuestas y
prompts de la IA, documentos y nombres de archivo del usuario, textos de
formación capturados por personas, nombres de modelos y proveedores, valores
técnicos (IDs, códigos, *Request ID*) y valores de enumeraciones guardados en la
base: de estos últimos solo se traduce la etiqueta que se muestra.
