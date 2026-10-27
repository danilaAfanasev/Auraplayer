import { describe, expect, it } from 'vitest';
import { installMediaCors, type HeadersListener } from './mediaCors';

function fakeSession() {
  let listener: HeadersListener | null = null;
  const session = {
    webRequest: {
      onHeadersReceived(fn: HeadersListener) {
        listener = fn;
      },
    },
  };
  installMediaCors(session);
  return (resourceType: string, responseHeaders?: Record<string, string[]>) =>
    new Promise<{ responseHeaders?: Record<string, string[]>; cancel?: boolean }>((resolve) => {
      if (!listener) throw new Error('обработчик не поставлен');
      listener({ resourceType, responseHeaders, url: 'https://rr1.googlevideo.com/videoplayback' }, resolve);
    });
}

describe('installMediaCors', () => {
  it('ответу звука (media) без заголовка дописывает Access-Control-Allow-Origin: *, прочие заголовки на месте', async () => {
    const respond = fakeSession();
    const res = await respond('media', { 'Content-Type': ['audio/webm'], 'Content-Length': ['100'] });
    expect(res.cancel).toBeFalsy();
    expect(res.responseHeaders).toEqual({
      'Content-Type': ['audio/webm'],
      'Content-Length': ['100'],
      'Access-Control-Allow-Origin': ['*'],
    });
  });

  it('заголовок уже есть (в любом регистре) — ответ не трогается', async () => {
    const respond = fakeSession();
    const res = await respond('media', { 'access-control-allow-origin': ['https://soundcloud.com'] });
    expect(res.responseHeaders).toBeUndefined();
  });

  it('не звук (страница, картинка, запрос API) — без изменений', async () => {
    const respond = fakeSession();
    for (const type of ['mainFrame', 'image', 'xhr', 'other']) {
      const res = await respond(type, { 'Content-Type': ['text/html'] });
      expect(res.responseHeaders).toBeUndefined();
    }
  });

  it('звук без заголовков вовсе — тоже получает разрешение', async () => {
    const respond = fakeSession();
    const res = await respond('media');
    expect(res.responseHeaders).toEqual({ 'Access-Control-Allow-Origin': ['*'] });
  });
});
