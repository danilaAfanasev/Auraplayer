// CORS для звука: <audio crossOrigin="anonymous"> отдаёт данные в звуковой граф рендерера (эквалайзер,
// саундвейв) только если ответ разрешает чтение. CDN YouTube, SoundCloud и Архива такого заголовка
// не ставят — дописываем `Access-Control-Allow-Origin: *` к ответам на запросы звука (resourceType
// `media`), ничего больше не трогая. Не прокси: звук идёт прямо с CDN, старт трека не замедляется (G11).
// Свой протокол `aura-media` сюда не попадает — заголовок ставит `mediaResponse` (`protocol.ts`).
// Модуль не импортирует electron во время выполнения: сессию передаёт main (`installMediaCors(session.defaultSession)`).

export interface HeadersDetails {
  resourceType: string;
  url: string;
  responseHeaders?: Record<string, string[]>;
}

export type HeadersListener = (
  details: HeadersDetails,
  callback: (response: { responseHeaders?: Record<string, string[]>; cancel?: boolean }) => void,
) => void;

/** Минимум от `Electron.Session`, нужный модулю. */
export interface SessionLike {
  webRequest: { onHeadersReceived(listener: HeadersListener): void };
}

const ALLOW_ORIGIN = 'access-control-allow-origin';

/** Новые заголовки ответа звука или undefined — ответ не трогать. */
function withAllowOrigin(details: HeadersDetails): Record<string, string[]> | undefined {
  if (details.resourceType !== 'media') return undefined;
  const headers = details.responseHeaders ?? {};
  if (Object.keys(headers).some((name) => name.toLowerCase() === ALLOW_ORIGIN)) return undefined;
  return { ...headers, 'Access-Control-Allow-Origin': ['*'] };
}

/** Ставится один раз на сессию окна (у сессии один обработчик onHeadersReceived — других в Aura нет). */
export function installMediaCors(session: SessionLike): void {
  session.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = withAllowOrigin(details);
    callback(responseHeaders ? { responseHeaders } : {});
  });
}
