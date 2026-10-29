// Картинка значка (SVG-строка из `shared/progressThumb`) в виде CSS-значения `url(...)`.

/** `url("data:image/svg+xml,…")`: кавычки внутри экранированы, так что строка безопасна в значении CSS-переменной. */
export function svgUrl(svg: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
