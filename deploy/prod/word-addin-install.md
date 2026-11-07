# Instalar el complemento LiTT en Word para su despacho

## Qué es y dónde está

LiTT es un asistente legal con IA que se abre como panel dentro de Word.
Para instalarlo, el administrador de Microsoft 365 usa su manifiesto (archivo XML):

**https://word.litt.asteroitt.com/manifest.xml**

Antes de empezar, abra ese vínculo en el navegador. Debe mostrar texto XML.
Si muestra un error, no continúe y avise a LiTT.

## Requisitos

- **Quién instala:** según Microsoft, un **administrador de Exchange**. También
  puede hacerlo quien tenga el rol *Application Administrator* en Microsoft
  Entra, o tenga activada la propiedad *App Registrations*.
- **Licencias de los usuarios:** Microsoft 365 Business, Office 365 o
  Microsoft 365 Enterprise (E1/E3/E5/F3), con buzón activo en Exchange Online.
  Las licencias Apps for Business o Apps for Enterprise sin Exchange Online no
  son compatibles.
- **Versión de Word:** Windows 1704 o posterior; Mac 15.34 o posterior.
  Word para la web también está soportado.

## Pasos de instalación

1. Inicie sesión en el **Centro de administración de Microsoft 365**.
2. En el menú izquierdo, seleccione **... Mostrar todo** > **Configuración** >
   **Aplicaciones integradas**.
3. En la parte superior de esa página, seleccione el vínculo **Complementos**
   (*Add-ins*).
4. Seleccione **Implementar complemento** (*Deploy Add-in*) y después **Siguiente**.
5. Elija subir un complemento personalizado (*upload a custom add-in*), no la
   tienda de Office.
6. En *Choose how to upload app*, elija la opción de dar un **vínculo** al
   manifiesto (*provide a URL for the manifest*), pegue
   `https://word.litt.asteroitt.com/manifest.xml` y seleccione **Cargar** (*Upload*).
7. Elija a quién se asigna:
   - **Solo yo** (*Just me*): para probar con su cuenta.
   - **Usuarios o grupos específicos** (*Specific users/groups*): el grupo piloto.
   - **Todos** (*Everyone*): toda la organización. Úselo solo después de la prueba.
8. Seleccione **Implementar** (*Deploy*). Aparece una marca verde cuando el
   complemento queda implementado. Si lo asignó solo a usted, después use
   *Change who has access to add-in* para ampliarlo.

El manifiesto de LiTT es del tipo «solo complemento» (XML). Microsoft indica que ese
tipo se implementa desde **Complementos** dentro de Aplicaciones integradas, como en
estos pasos. Sus instrucciones para el manifiesto unificado de Microsoft 365, que LiTT
no usa, son otras.

**Recomendación:** empiece con usted y un grupo piloto de pocas personas
(abogados y TI). Si funciona, amplíe a más usuarios y al final a todo el
despacho. Microsoft recomienda este orden por fases.

## A quién asignarlo

Asigne LiTT a un **grupo** de abogados, no a personas sueltas. Quien entra al
grupo recibe LiTT, y quien sale lo pierde sin más trámite.

- Microsoft soporta grupos de Microsoft 365, listas de distribución, grupos
  dinámicos y grupos de seguridad **habilitados para correo**.
- **No** soporta grupos de seguridad que no estén habilitados para correo.
- Los grupos anidados (grupos dentro de grupos) no reciben el complemento.
  Asigne el grupo que contiene directamente a los abogados.

## Cuándo aparece

Microsoft indica que puede tardar **hasta 24 horas** en aparecer en todos los
equipos. Otra página de Microsoft indica **24 a 72 horas** para aparecer en la
cinta de opciones. Use el plazo más largo como referencia.

Los usuarios deben **cerrar y volver a abrir Word** para ver el botón.

## Cómo comprobar que funciona

1. Abra Word (de escritorio o para la web) con cualquier documento.
2. En la pestaña **Inicio** debe aparecer el grupo **LiTT Legal AI**.
3. Seleccione el botón **LiTT** para abrir el panel.

Si no aparece, espere el plazo indicado y reinicie Word. Para revisar si el
complemento está instalado, vaya a **Inicio > Complementos > + Más
complementos > Administrar las aplicaciones**. Si LiTT aparece ahí, la
instalación está bien y solo falta que se refresque. Si después de 72 horas no
aparece, avise a LiTT con el nombre del usuario y del equipo.

## Actualizaciones

LiTT actualiza su aplicación web sin acción del administrador.

Si LiTT cambia el manifiesto (por ejemplo, el icono o el texto del botón),
seleccione LiTT en **Aplicaciones integradas** y use el botón **Update**
(Actualizar) de la esquina inferior derecha. Microsoft no documenta una
actualización automática del manifiesto cuando se carga por vínculo, así que
no lo damos por hecho.

## Cómo quitarlo

1. En **Configuración > Aplicaciones integradas**, seleccione **LiTT**.
2. En el panel de propiedades, verifique que **Información general** esté seleccionada.
3. Seleccione **Quitar aplicaciones**, marque **Sí, estoy seguro de que quiero
   quitar la aplicación y los datos asociados** y seleccione **Quitar**.

Para dejar de usarlo sin borrarlo, quite usuarios en **Usuarios > Usuarios
asignados > Actualizar**. Microsoft no indica un plazo concreto para que
desaparezca de los equipos.

## Instalación manual para pruebas (sideload)

Esta forma instala LiTT solo para una persona y en un navegador, para pruebas. No
sustituye la implementación del administrador.

1. Abra Word para la web con un documento.
2. Seleccione **Inicio > Complementos**, luego **Más configuración** (*More
   Settings*).
3. En el cuadro *Office Add-ins*, seleccione **Cargar mi complemento** (*Upload My
   Add-in*).
4. Con **Examinar** (*Browse*), elija el archivo `manifest.xml` descargado de
   https://word.litt.asteroitt.com/manifest.xml y seleccione **Cargar** (*Upload*).

Queda guardado solo en ese navegador; si borra la caché, hay que cargarlo de
nuevo. Para Mac y Windows, consulte la documentación oficial de Office Add-ins
sobre *sideload*.

## Fuentes consultadas (consultadas el 7 de noviembre de 2026)

- Deploy Office Add-ins in the Microsoft 365 admin center:
  https://learn.microsoft.com/en-us/microsoft-365/admin/manage/manage-deployment-of-add-ins
- Determine if centralized deployment of Office Add-ins works for your organization:
  https://learn.microsoft.com/en-us/microsoft-365/admin/manage/centralized-deployment-of-add-ins
- Administración de complementos en el Centro de administración de Microsoft 365 (versión en español):
  https://learn.microsoft.com/es-es/microsoft-365/admin/manage/manage-addins-in-the-admin-center
- Sideload Office Add-ins to Office on the web:
  https://learn.microsoft.com/en-us/office/dev/add-ins/testing/sideload-office-add-ins-for-testing

Las etiquetas en inglés entre paréntesis no se confirmaron en la versión en
español de Microsoft Learn.

Más adelante LiTT estará en AppSource; mientras tanto se instala con este manifiesto.
