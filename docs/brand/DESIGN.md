## Wordmark — LiTT v1.0

### Concepto
LiTT abre como escrito y termina como pantalla. La **L** es serifa (Newsreader): la capitular del escrito jurídico. **ıTT** es pixel monoespaciado (Departure Mono): la herramienta abierta. El punto de la i es un **cuadrado ámbar**, un cursor encendido: el lugar donde la letra se vuelve herramienta. El mismo cuadrado cierra el monograma **«L.»**, en el registro de abreviatura del escrito jurídico mexicano (Lic., Art., Fr.).

### Tipografías (SIL OFL 1.1)
| Rol | Fuente | Ajustes | Origen |
|---|---|---|---|
| L | Newsreader (Production Type) | `wght 600`, `opsz 72`, sin óptica automática | github.com/google/fonts · ofl/newsreader |
| ıTT, favicon | Departure Mono (Helena Zhang) | Regular, sin kerning, tracking 0 | github.com/rektdeckard/departure-mono |

### Construcción modular
**X** = font-size de Departure Mono. **u** = X / 11, el píxel de la fuente. Origen: tinta izquierda de la L, sobre la línea base; y positiva hacia arriba.

| Elemento | u | X |
|---|---|---|
| Cuerpo de la L | 11.1888u | 1.0172X |
| Altura de mayúscula (L, T) | 8u | 0.7273X |
| Altura de la ı | 6u | 0.5455X |
| Origen de la ı | 8u | 0.7273X |
| Origen de la T₁ / T₂ | 15u / 22u | 1.3636X / 2X |
| Espolón de la L → tinta de la ı | 2.045u | 0.1859X |
| Tinta → tinta entre ı, T, T (monoespacio) | 2u | 0.1818X |
| Cuadrado de la i: lado | 3u | 0.2727X |
| Cuadrado de la i: x / base | 10u / 7u (sobre la línea base) | 0.9091X / 0.6364X |
| Separación cuadrado → ı (vertical) | 1u | 0.0909X |
| Caja de tinta | 28u × 10.371u (de +10u a −0.371u, el espolón baja de la línea) | 2.5455X × 0.9428X |
| Área de protección, por lado | 4u | 0.3636X |
| Caja con protección | 36u × 18.371u | 3.2727X × 1.6701X |

**Monograma «L.», corte serifa** (avatares, 64 px en adelante)
- Lienzo de 20u × 20u.
- Tinta izquierda de la L en x = 4.5u; línea base en y = 14u desde arriba.
- Cuadrado de 3u en x = 8u desde la tinta izquierda de la L, apoyado en la línea base. El hueco L → punto es de 1.045u.

**Monograma «L.», corte pixel** (favicon e íconos de 16, 32 y 48 px)
- L de Departure Mono, de 5u × 8u.
- Hueco de 1u y cuadrado de 3u en la línea base.
- Lienzo de 16u; tinta centrada (desplazamiento horizontal de 3.5u, redondeado al píxel). u = 1 px a 16 px, 2 px a 32 px, 3 px a 48 px.
- Debe quedar sin antialias: exactamente 3 colores por archivo.

### Color
| Token | Hex | Uso |
|---|---|---|
| tinta | `#151A26` | Fondo del tema oscuro; letras en tema claro |
| papel | `#ECECE6` | Fondo del tema claro; letras en tema oscuro |
| ámbar fósforo | `#FFB21E` | Cuadrado, solo sobre tinta |
| ámbar tinta | `#965900` | Cuadrado, solo sobre papel o blanco |

| Par | Contraste |
|---|---|
| papel / tinta | 14.66:1 |
| ámbar fósforo / tinta | 9.64:1 |
| ámbar tinta / papel | 4.75:1 |
| ámbar tinta / blanco | 5.64:1 |
| tinta / blanco | 17.39:1 |
| ámbar fósforo / papel | **1.52:1 (prohibido)** |

### Versiones y usos
| Versión | Archivo | Uso |
|---|---|---|
| Color oscuro (principal) | `litt-wordmark-color-oscuro` | Producto en tema oscuro, presentaciones, redes |
| Color claro | `litt-wordmark-color-claro` | Producto en tema claro, documentos, web clara |
| Monocroma clara | `litt-wordmark-mono-claro` (transparente) | Fondos oscuros o fotografía oscura con ≥4.5:1 frente a papel; una tinta clara |
| Monocroma oscura | `litt-wordmark-mono-oscuro` (transparente) | Fondos claros, impresión a una tinta, documentos en B/N, sellos |
| Monograma «L.» serifa | `litt-monograma-{oscuro,claro}-{1024,512}` | Avatares y perfiles, 64 px en adelante; seguro en recorte circular |
| Monograma «L.» pixel | `favicon-16`, `favicon-32`, `favicon-32-claro`, `favicon.ico` | Pestañas, favicons, íconos de 48 px o menos |
| Referencia viva | `wordmark.html` | Snippet HTML+CSS con `--x` |

Los SVG llevan contornos, sin dependencia de fuentes, e incluyen el área de protección. Los PNG de wordmark están a X = 440 px (u = 40 px).

### Tamaños mínimos
- **Wordmark en pantalla:** X ≥ 22 px (ancho de tinta 56 px). Por debajo, usar el monograma.
- **Retícula en pantalla:** con X < 66 px, X debe ser múltiplo de 11 px para que ıTT caiga en píxeles enteros.
- **Wordmark impreso:** ancho de tinta ≥ 18 mm.
- **Monograma serifa:** ≥ 64 px.
- **Monograma pixel:** 16, 32 o 48 px exactos.

### Prohibiciones
1. No reescribir el wordmark tecleándolo en otra fuente ni sustituir Newsreader o Departure Mono por "parecidas".
2. No cambiar la capitalización: nunca Litt, LITT, litt ni LiTt. En texto corrido el nombre se escribe LiTT en la tipografía del texto, sin imitar el wordmark.
3. No usar la i con punto redondo, no omitir el cuadrado y no cambiar su lado (3u), su posición ni su forma.
4. No pasar la L a pixel ni la ıTT a serifa. Única excepción: el monograma pixel de 48 px o menos.
5. No usar la L sola como marca reducida. Siempre «L.» con su punto cuadrado: sin él colisiona con la inicial de Legora.
6. No usar el corte serifa del monograma por debajo de 64 px ni el corte pixel por encima de 48 px.
7. No poner el ámbar fósforo sobre papel ni sobre fondos claros, ni el ámbar tinta sobre tinta. El ámbar nunca va en las letras: es exclusivo del cuadrado. Excepción aprobada (2026-11-13, decisión del dueño), solo para la flecha del botón de enviar:
    - Qué cubre: la flecha del botón de enviar (`COMPOSER_SEND_BUTTON_CLASS`): la casilla del chat en la web y en Word, y «Agregar al chat» en el menú de citas.
    - Color: ámbar fósforo `#FFB21E` sobre un fondo tinta `#151A26`, en los dos temas.
    - Cuándo: solo en el estado «listo para enviar». Deshabilitado (gris) y «Detener» (cuadro papel sobre tinta) no llevan ámbar.
    - Dibujo: la flecha va en la retícula de píxel (7 × 7, u = 2 px). Su único movimiento es avanzar 1u al pasar el mouse.
    - Qué no cubre: otros íconos, textos o botones, ni el wordmark ni el monograma.
8. No aplicar tracking, kerning ni cambios a los espacios: 2.045u del espolón a la ı y 2u entre glifos pixel.
9. No deformar, inclinar, rotar, contornear, sombrear, degradar ni aplicar brillo o glow. Excepción aprobada (2026-11-13, decisión del dueño): en el estado de error del indicador de estado (`LittStatusMarkUI`), el cuadrado se apaga y queda solo su contorno en `gray-500`. No aplica al wordmark ni al monograma.
10. No animar el cuadrado (parpadeo de cursor, pulso) sin una spec de movimiento aprobada. Spec aprobada (2026-11-13, decisión del dueño), solo para el indicador de estado del asistente (`LittStatusMarkUI`, «A · Cursor») y nunca para el wordmark ni el monograma:
    - Trabajando: el cuadrado parpadea de opacidad 1 a 0.2 en un ciclo de 1200 ms, sin bajar de 0.2.
    - Esperando: el cuadrado queda en ámbar atenuado (opacidad 0.55) y bajo él se forman tres puntos, uno cada 450 ms, en el mismo ámbar atenuado; ciclo de 1800 ms.
    - Terminado: bajo el cuadrado, que sigue en ámbar, se traza un renglón verde (`--litt-status-done`: emerald-700 en claro, emerald-400 en oscuro) en 7 pasos de 30 ms; se sostiene 1.5 s y sale en 160 ms. El verde es excepción aprobada y solo va en ese renglón.
    - Error: el relleno se apaga en 120 ms y queda el contorno (regla 9).
    - Con `prefers-reduced-motion: reduce` no hay animación: trabajando = renglón estático hasta el cuadrado, esperando = tres puntos fijos, terminado = renglón completo.
    - Subagentes: cada uno toma un tono propio (teal, pink, lime, stone); el ámbar queda solo para LiTT.
11. No colocar el wordmark sobre fondos o fotos con menos de 4.5:1 frente al color de las letras, ni invadir el área de protección de 4u.
12. No usar una versión de color en el tema contrario (color claro sobre fondo oscuro o al revés).
13. No escalar el corte pixel con interpolación: los favicons se usan a su tamaño nativo.

### Referencia HTML + CSS
```html
<span class="litt" role="img" aria-label="LiTT">
  <svg viewBox="0 0 28 10.3709" aria-hidden="true">
    <text class="litt-l"  x="-0.3306" y="10">L</text>
    <text class="litt-px" x="8" y="10">ıTT</text>
    <rect class="litt-dot" x="10" y="0" width="3" height="3"/>
  </svg>
</span>
```
```css
/* Requiere @font-face de Newsreader (variable, wght+opsz) y Departure Mono */
.litt {
  --x: 44px;                         /* unidad base: font-size de Departure Mono */
  --litt-ink: #151A26; --litt-accent: #965900;   /* tema claro */
  display: inline-block;
  padding: calc(var(--x) * 4 / 11);  /* área de protección = 4u */
  line-height: 0;
}
.litt svg { display: block; overflow: visible;
  width: calc(var(--x) * 28 / 11); height: calc(var(--x) * 10.3709 / 11); }
.litt text { font-kerning: none; letter-spacing: 0; fill: var(--litt-ink); }
.litt-l { font-family: "Newsreader", serif; font-size: 11.1888px;
  font-variation-settings: "wght" 600, "opsz" 72; font-optical-sizing: none; }
.litt-px { font-family: "Departure Mono", monospace; font-size: 11px; }
.litt-dot { fill: var(--litt-accent); }
/* tema oscuro: --litt-ink: #ECECE6; --litt-accent: #FFB21E; */
```
Dentro del SVG, 1 unidad de usuario = 1u; `--x` solo fija la escala. Verificado: el render con fuentes vivas y el SVG con contornos difieren en 0.038 % de los píxeles de tinta (solo antialias de curvas).
