import { describe, expect, it } from 'vitest';
import { compareVersions, parseLatestRelease, parseVersion, releaseNotesText, UPDATE_REPO } from './version';

const SHA = 'a'.repeat(64);

/** Ответ GitHub `releases/latest` (поля, которые читает Aura). */
function release(over: Record<string, unknown> = {}, assets?: unknown[]): Record<string, unknown> {
  return {
    tag_name: 'v0.3.0',
    name: 'Aura 0.3.0',
    draft: false,
    prerelease: false,
    html_url: 'https://github.com/danilaAfanasev/Auraplayer/releases/tag/v0.3.0',
    body: '## Что нового\n\n- **Эквалайзер** в панели плеера\n- Тексты песен',
    assets: assets ?? [
      {
        name: 'Aura-Setup-0.3.0.exe',
        size: 98_765_432,
        browser_download_url: 'https://github.com/danilaAfanasev/Auraplayer/releases/download/v0.3.0/Aura-Setup-0.3.0.exe',
        digest: `sha256:${SHA}`,
      },
    ],
    ...over,
  };
}

describe('parseVersion', () => {
  it('X.Y.Z с префиксом v и без', () => {
    expect(parseVersion('0.2.1')).toEqual([0, 2, 1]);
    expect(parseVersion('v0.2.1')).toEqual([0, 2, 1]);
    expect(parseVersion(' v10.0.12 ')).toEqual([10, 0, 12]);
  });

  it('не версия — null', () => {
    for (const s of ['', '0.2', '1.2.3.4', 'v', 'latest', '0.3.0-beta', 'x1.2.3']) expect(parseVersion(s)).toBeNull();
  });
});

describe('compareVersions', () => {
  it('сравнение по числам, а не по строкам', () => {
    expect(compareVersions('0.2.10', '0.2.9')).toBe(1);
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1);
    expect(compareVersions('1.0.0', '0.99.99')).toBe(1);
    expect(compareVersions('0.2.1', '0.3.0')).toBe(-1);
  });

  it('равные версии — 0, префикс v не важен', () => {
    expect(compareVersions('v0.2.1', '0.2.1')).toBe(0);
  });

  it('невалидная версия меньше любой валидной', () => {
    expect(compareVersions('мусор', '0.0.1')).toBe(-1);
    expect(compareVersions('0.0.1', '')).toBe(1);
    expect(compareVersions('a', 'b')).toBe(0);
  });
});

describe('parseLatestRelease', () => {
  it('релиз новее установленной — обновление с файлом установщика, размером и суммой', () => {
    expect(parseLatestRelease(release(), '0.2.1')).toEqual({
      version: '0.3.0',
      notes: 'Что нового\n\n• Эквалайзер в панели плеера\n• Тексты песен',
      pageUrl: 'https://github.com/danilaAfanasev/Auraplayer/releases/tag/v0.3.0',
      assetUrl: 'https://github.com/danilaAfanasev/Auraplayer/releases/download/v0.3.0/Aura-Setup-0.3.0.exe',
      assetName: 'Aura-Setup-0.3.0.exe',
      size: 98_765_432,
      sha256: SHA,
    });
  });

  it('тег без префикса v тоже читается', () => {
    expect(parseLatestRelease(release({ tag_name: '0.3.0' }), '0.2.1')?.version).toBe('0.3.0');
  });

  it('та же или старшая установленная версия — обновления нет', () => {
    expect(parseLatestRelease(release(), '0.3.0')).toBeNull();
    expect(parseLatestRelease(release(), '0.3.1')).toBeNull();
  });

  it('в релизе нет файла Aura-Setup-*.exe — обновления нет', () => {
    const noExe = release({}, [
      { name: 'Aura-0.3.0.zip', size: 10, browser_download_url: 'https://github.com/x/y/releases/download/v0.3.0/Aura-0.3.0.zip' },
      { name: 'latest.yml', size: 10, browser_download_url: 'https://github.com/x/y/releases/download/v0.3.0/latest.yml' },
    ]);
    expect(parseLatestRelease(noExe, '0.2.1')).toBeNull();
    expect(parseLatestRelease(release({}, []), '0.2.1')).toBeNull();
  });

  it('черновик и пререлиз — обновления нет', () => {
    expect(parseLatestRelease(release({ draft: true }), '0.2.1')).toBeNull();
    expect(parseLatestRelease(release({ prerelease: true }), '0.2.1')).toBeNull();
  });

  it('битый ответ — обновления нет', () => {
    for (const raw of [null, undefined, 'строка', 42, [], {}, { tag_name: 'latest', assets: [] }, release({ assets: 'нет' })]) {
      expect(parseLatestRelease(raw, '0.2.1')).toBeNull();
    }
    // файл без размера или с адресом не http(s)
    const badAsset = (a: Record<string, unknown>) =>
      release({}, [{ name: 'Aura-Setup-0.3.0.exe', size: 5, browser_download_url: 'https://github.com/x/Aura-Setup-0.3.0.exe', ...a }]);
    expect(parseLatestRelease(badAsset({ size: 0 }), '0.2.1')).toBeNull();
    expect(parseLatestRelease(badAsset({ browser_download_url: 'file:///C:/evil.exe' }), '0.2.1')).toBeNull();
  });

  it('нет описания и страницы релиза — пустой текст и страница релизов репозитория; digest не sha256 — без суммы', () => {
    const info = parseLatestRelease(release({ body: null, html_url: undefined }, [{ name: 'Aura-Setup-0.3.0.exe', size: 5, browser_download_url: 'https://github.com/x/a.exe', digest: 'md5:00' }]), '0.2.1');
    expect(info).toMatchObject({ notes: '', pageUrl: `https://github.com/${UPDATE_REPO}/releases`, size: 5 });
    expect(info && 'sha256' in info).toBe(false);
  });

  it('несколько установщиков — берётся файл этой версии', () => {
    const info = parseLatestRelease(
      release({}, [
        { name: 'Aura-Setup-0.2.9.exe', size: 1, browser_download_url: 'https://github.com/x/old.exe' },
        { name: 'Aura-Setup-0.3.0.exe', size: 2, browser_download_url: 'https://github.com/x/new.exe' },
      ]),
      '0.2.1',
    );
    expect(info?.assetName).toBe('Aura-Setup-0.3.0.exe');
  });
});

describe('releaseNotesText', () => {
  it('разметка Markdown убрана: заголовки, жирный, курсив, код, ссылки, картинки, цитаты, списки', () => {
    const md = [
      '# Aura 0.3.0',
      '',
      '![скриншот](https://example.com/a.png)',
      '> Важное: **обнови** yt-dlp',
      '* пункт со *звёздочкой* и `кодом`',
      '1. [Ссылка](https://example.com) на __страницу__',
      '---',
      '<details>Подробнее</details>',
    ].join('\n');
    expect(releaseNotesText(md)).toBe(['Aura 0.3.0', '', 'Важное: обнови yt-dlp', '• пункт со звёздочкой и кодом', '1. Ссылка на страницу', 'Подробнее'].join('\n'));
  });

  it('не больше 12 строк, лишнее — многоточием; подряд пустые строки схлопнуты', () => {
    const md = Array.from({ length: 20 }, (_, i) => `- пункт ${i + 1}`).join('\n\n\n');
    const lines = releaseNotesText(md).split('\n');
    expect(lines.length).toBeLessThanOrEqual(12);
    expect(lines[0]).toBe('• пункт 1');
    expect(lines.at(-1)).toBe('…');
    expect(lines.filter((l, i) => l === '' && lines[i + 1] === '')).toEqual([]);
    expect(releaseNotesText('a\nb\nc', 2)).toBe('a\n…');
  });

  it('блок кода без ограждений, пробелы по краям и \\r\\n', () => {
    expect(releaseNotesText('\r\n\r\n```\nnpm run dist\n```\r\nГотово  \r\n')).toBe('npm run dist\nГотово');
  });
});

describe('parseLatestRelease — имя файла установщика безопасно для пути', () => {
  it('имя с разделителями пути, «..», пробелами или кавычками — не установщик', () => {
    for (const name of [
      'Aura-Setup-../../evil.exe',
      String.raw`Aura-Setup-..\..\evil.exe`,
      'Aura-Setup-0.3.0/evil.exe',
      'Aura-Setup-a b.exe',
      "Aura-Setup-’; Write-Output INJECTED; ’.exe",
      "Aura-Setup-x'y.exe",
    ]) {
      const json = release({}, [{ name, size: 5, browser_download_url: 'https://github.com/x/a.exe' }]);
      expect(parseLatestRelease(json, '0.2.1')).toBeNull();
    }
  });

  it('обычные имена проходят', () => {
    for (const name of ['Aura-Setup-0.3.0.exe', 'Aura-Setup-0.3.0-x64.exe']) {
      const json = release({}, [{ name, size: 5, browser_download_url: 'https://github.com/x/a.exe' }]);
      expect(parseLatestRelease(json, '0.2.1')?.assetName).toBe(name);
    }
  });
});
