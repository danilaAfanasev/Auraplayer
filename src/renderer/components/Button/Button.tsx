import type { LucideIcon } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.css';

type Variant = 'accent' | 'outline' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: LucideIcon;
  children?: ReactNode;
}

/** Кнопка с текстом: акцентная (заливка акцентом), контурная или «призрачная». */
export function Button({ variant = 'accent', icon: Icon, children, className, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={[styles.button, styles[variant], className].filter(Boolean).join(' ')} {...rest}>
      {Icon && <Icon size={17} strokeWidth={2.2} />}
      {children}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  /** Подпись для подсказки и экранных дикторов. */
  label: string;
  size?: 'small' | 'medium' | 'large';
  active?: boolean;
  /** Иконка залита (например, ♥ у понравившегося трека). */
  filled?: boolean;
  /** Кнопка-переключатель (повтор, перемешивание): включённая — с подложкой и точкой под иконкой. */
  toggle?: boolean;
}

/** Круглая кнопка-иконка. */
export function IconButton({
  icon: Icon,
  label,
  size = 'medium',
  active = false,
  filled = false,
  toggle = false,
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  const iconSize = size === 'small' ? 16 : size === 'large' ? 22 : 18;
  return (
    <button
      type={type}
      title={label}
      aria-label={label}
      aria-pressed={active || undefined}
      className={[
        styles.iconButton,
        styles[size],
        active ? styles.active : '',
        toggle ? styles.toggle : '',
        toggle && active ? styles.toggleOn : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      <Icon size={iconSize} strokeWidth={2} fill={filled ? 'currentColor' : 'none'} />
    </button>
  );
}
