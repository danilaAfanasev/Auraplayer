import { Pencil, Plus, SlidersHorizontal, Trash2, Type } from 'lucide-react';
import { nanoid } from 'nanoid';
import { useMemo, useRef, useState } from 'react';
import {
  BUILTIN_THUMBS,
  MAX_CUSTOM_THUMBS,
  MAX_THUMB_NAME,
  type CustomThumb,
  type ThumbChoice,
} from '../../../shared/progressThumb';
import { ThumbEditor } from '../../components/ProgressThumb/ThumbEditor';
import { ThumbGlyph } from '../../components/ProgressThumb/ThumbGlyph';
import { ThumbRange } from '../../components/ProgressThumb/ThumbRange';
import { useSettings } from '../../stores/useSettings';
import { useUi } from '../../stores/useUi';
import { SettingsSection } from './SettingsSection';
import styles from './ThumbSection.module.css';

const sameChoice = (a: ThumbChoice, b: ThumbChoice): boolean => a.kind === b.kind && a.id === b.id;

/** Подпись значка в сетке: название и, если выбран, пометка. */
function ThumbCard({
  choice,
  name,
  customs,
  selected,
  onPick,
  onHover,
}: {
  choice: ThumbChoice;
  name: string;
  customs: readonly CustomThumb[];
  selected: boolean;
  onPick(): void;
  onHover(on: boolean): void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={name}
      className={[styles.cardMain, selected ? styles.selected : ''].filter(Boolean).join(' ')}
      onClick={onPick}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
    >
      <span className={styles.glyphBox}>
        <ThumbGlyph choice={choice} customs={customs} scale={2} spin />
      </span>
      <span className={styles.name}>{name}</span>
    </button>
  );
}

/** Имя своего значка: по нажатию «Переименовать» превращается в поле ввода. */
function RenameField({ initial, onDone }: { initial: string; onDone(name: string | null): void }) {
  const [value, setValue] = useState(initial);
  const finished = useRef(false);
  const finish = (name: string | null) => {
    if (finished.current) return;
    finished.current = true;
    onDone(name);
  };
  return (
    <input
      autoFocus
      className={styles.rename}
      value={value}
      maxLength={MAX_THUMB_NAME}
      aria-label="Название значка"
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => finish(value.trim() || null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(value.trim() || null);
        if (e.key === 'Escape') {
          e.stopPropagation();
          finish(null);
        }
      }}
    />
  );
}

/**
 * Раздел «Ползунок»: значок на полосе трека (панель плеера и экран текста) — 16 встроенных и до 12 нарисованных
 * самим пользователем. Над сеткой — настоящая полоса: на неё сразу падает выбранный (или тот, что под курсором) значок.
 */
export function ThumbSection() {
  const choice = useSettings((s) => s.settings.progressThumb);
  const customs = useSettings((s) => s.settings.customThumbs);
  const update = useSettings((s) => s.update);
  const toast = useUi((s) => s.toast);
  const [hover, setHover] = useState<ThumbChoice | null>(null);
  const [demo, setDemo] = useState(35);
  const [editing, setEditing] = useState<CustomThumb | 'new' | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  const shown = hover ?? choice;
  const full = customs.length >= MAX_CUSTOM_THUMBS;
  const nextName = useMemo(() => {
    for (let n = customs.length + 1; ; n++) {
      const name = `Мой значок ${n}`;
      if (!customs.some((c) => c.name === name)) return name;
    }
  }, [customs]);

  const pick = (next: ThumbChoice) => update({ progressThumb: next });

  const save = (draft: { name: string; palette: string[]; pixels: string }) => {
    if (editing === 'new') {
      const thumb: CustomThumb = { id: nanoid(10), ...draft };
      update({ customThumbs: [...customs, thumb], progressThumb: { kind: 'custom', id: thumb.id } });
    } else if (editing) {
      const id = editing.id;
      update({ customThumbs: customs.map((c) => (c.id === id ? { id, ...draft } : c)) });
    }
    setEditing(null);
  };

  const rename = (id: string, name: string | null) => {
    setRenaming(null);
    if (name) update({ customThumbs: customs.map((c) => (c.id === id ? { ...c, name: name.slice(0, MAX_THUMB_NAME) } : c)) });
  };

  const remove = (thumb: CustomThumb) => {
    const at = customs.findIndex((c) => c.id === thumb.id);
    const wasSelected = choice.kind === 'custom' && choice.id === thumb.id;
    setHover(null);
    update({ customThumbs: customs.filter((c) => c.id !== thumb.id), ...(wasSelected ? { progressThumb: { kind: 'builtin', id: 'dot' } } : {}) });
    toast(`Значок «${thumb.name}» удалён`, {
      label: 'Вернуть',
      run: () => {
        const now = useSettings.getState().settings.customThumbs;
        if (now.length >= MAX_CUSTOM_THUMBS || now.some((c) => c.id === thumb.id)) return;
        const restored = [...now];
        restored.splice(Math.min(at, restored.length), 0, thumb);
        update({ customThumbs: restored, ...(wasSelected ? { progressThumb: { kind: 'custom', id: thumb.id } } : {}) });
      },
    });
  };

  return (
    <SettingsSection
      id="thumb"
      icon={SlidersHorizontal}
      title="Ползунок"
      description="Значок на полосе трека — в панели плеера и на экране текста. Громкость остаётся обычным кружком."
    >
      <div className={styles.live}>
        <span className={styles.liveLabel}>Предпросмотр на полосе — её можно двигать</span>
        <ThumbRange
          fill={demo}
          choice={shown}
          customs={customs}
          spin
          min={0}
          max={100}
          step={1}
          value={demo}
          aria-label="Предпросмотр значка на полосе"
          onChange={(e) => setDemo(Number(e.target.value))}
        />
      </div>

      <div className={styles.group}>
        <h3 className={styles.head}>Встроенные</h3>
        <div className={styles.grid} role="radiogroup" aria-label="Встроенные значки">
          {BUILTIN_THUMBS.map(({ id, name }) => {
            const value: ThumbChoice = { kind: 'builtin', id };
            return (
              <div key={id} className={styles.card}>
                <ThumbCard
                  choice={value}
                  name={name}
                  customs={customs}
                  selected={sameChoice(choice, value)}
                  onPick={() => pick(value)}
                  onHover={(on) => setHover(on ? value : null)}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className={styles.group}>
        <h3 className={styles.head}>
          Мои<span className={styles.count}>{customs.length} из {MAX_CUSTOM_THUMBS}</span>
        </h3>
        <div className={styles.grid} role="radiogroup" aria-label="Мои значки">
          {customs.map((thumb) => {
            const value: ThumbChoice = { kind: 'custom', id: thumb.id };
            return (
              <div key={thumb.id} className={styles.card}>
                {renaming === thumb.id ? (
                  <div className={styles.cardMain}>
                    <span className={styles.glyphBox}>
                      <ThumbGlyph choice={value} customs={customs} scale={2} />
                    </span>
                    <RenameField initial={thumb.name} onDone={(name) => rename(thumb.id, name)} />
                  </div>
                ) : (
                  <ThumbCard
                    choice={value}
                    name={thumb.name}
                    customs={customs}
                    selected={sameChoice(choice, value)}
                    onPick={() => pick(value)}
                    onHover={(on) => setHover(on ? value : null)}
                  />
                )}
                <div className={styles.tools}>
                  <button type="button" className={styles.tool} title="Изменить" aria-label={`Изменить «${thumb.name}»`} onClick={() => setEditing(thumb)}>
                    <Pencil size={14} strokeWidth={2.2} />
                  </button>
                  <button type="button" className={styles.tool} title="Переименовать" aria-label={`Переименовать «${thumb.name}»`} onClick={() => setRenaming(thumb.id)}>
                    <Type size={14} strokeWidth={2.2} />
                  </button>
                  <button type="button" className={styles.tool} title="Удалить" aria-label={`Удалить «${thumb.name}»`} onClick={() => remove(thumb)}>
                    <Trash2 size={14} strokeWidth={2.2} />
                  </button>
                </div>
              </div>
            );
          })}
          <button
            type="button"
            className={styles.add}
            disabled={full}
            title={full ? 'Своих значков уже 12 — удали ненужный' : undefined}
            onClick={() => setEditing('new')}
          >
            <Plus size={22} strokeWidth={2.2} />
            Нарисовать свой
          </button>
        </div>
        {customs.length === 0 && <p className={styles.hint}>Здесь будут значки, которые ты нарисуешь: сетка 24×24 клетки, кисть, ластик, заливка.</p>}
      </div>

      {editing && (
        <ThumbEditor
          key={editing === 'new' ? 'new' : editing.id}
          initial={editing === 'new' ? undefined : editing}
          defaultName={nextName}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}
    </SettingsSection>
  );
}
