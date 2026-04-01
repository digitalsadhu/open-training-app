export const TAB_ITEMS = [
  { id: 'programs', label: 'Programs', icon: 'table-list', path: '/programs' },
  { id: 'train', label: 'Train', icon: 'dumbbell', path: '/train' },
  { id: 'progress', label: 'Progress', icon: 'chart-line', path: '/progress' },
  { id: 'settings', label: 'Settings', icon: 'gear', path: '/settings' }
];

const DEFAULT_TAB = 'programs';

export const normalizePathname = pathname => {
  const raw = String(pathname || '/').trim() || '/';
  const ensured = raw.startsWith('/') ? raw : `/${raw}`;
  if (ensured === '/index.html' || ensured === '/index') return '/';
  return ensured.endsWith('/') && ensured.length > 1 ? ensured.slice(0, -1) : ensured;
};

export const pathFromTab = tabId => {
  const match = TAB_ITEMS.find(item => item.id === tabId);
  return match?.path || '/programs';
};

export const tabFromPath = pathname => {
  const normalized = normalizePathname(pathname);
  if (normalized === '/') {
    return { tab: DEFAULT_TAB, normalizedPath: '/programs', requiresRedirect: true };
  }
  const matched = TAB_ITEMS.find(item => item.path === normalized);
  if (matched) {
    return { tab: matched.id, normalizedPath: matched.path, requiresRedirect: false };
  }
  return { tab: DEFAULT_TAB, normalizedPath: '/programs', requiresRedirect: true };
};

export const labelFromTab = tabId => {
  const match = TAB_ITEMS.find(item => item.id === tabId);
  return match?.label || 'Programs';
};

export const titleFromTab = tabId => {
  const label = labelFromTab(tabId);
  return `Open Training App · ${label}`;
};
