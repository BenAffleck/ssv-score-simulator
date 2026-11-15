import { useState } from 'react';

type Theme = 'light' | 'ssvdark';

function applyTheme(theme: Theme): void {
  if (theme === 'ssvdark') document.documentElement.setAttribute('data-theme', 'ssvdark');
  else document.documentElement.removeAttribute('data-theme');
  try {
    localStorage.setItem('theme', theme);
  } catch {
    /* storage unavailable — theme just won't persist */
  }
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.getAttribute('data-theme') === 'ssvdark' ? 'ssvdark' : 'light',
  );
  const next: Theme = theme === 'light' ? 'ssvdark' : 'light';
  return (
    <button
      className="theme-toggle"
      title={`Switch to ${next === 'ssvdark' ? 'dark' : 'light'} theme`}
      aria-label="Toggle theme"
      onClick={() => {
        applyTheme(next);
        setTheme(next);
      }}
    >
      {theme === 'light' ? '☾' : '☀'}
    </button>
  );
}
