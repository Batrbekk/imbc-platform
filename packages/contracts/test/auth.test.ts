import { describe, expect, it } from 'vitest';
import { destinationFor, roleHome, safeReturnTo } from '../src/auth.js';
import { ROLES, type Role } from '../src/enums.js';
import { can, type Action } from '../src/policy.js';

describe('authentication navigation', () => {
  it.each([
    '//outside.invalid',
    '/\\outside.invalid',
    '/%5coutside.invalid',
    '/\n/outside.invalid',
    'https://outside.invalid',
    'javascript:alert(1)',
    '/%0a/outside.invalid',
    undefined,
  ])('rejects an unsafe return path', (value) => expect(safeReturnTo(value, '/account')).toBe('/account'));
  it('keeps and normalizes local paths without trusting the fallback', () => {
    expect(safeReturnTo('/catalog/../profile?tab=main#section')).toBe('/profile?tab=main#section');
    expect(safeReturnTo('//outside.invalid', '//outside.invalid')).toBe('/');
  });
  it('стартовая страница по роли: дашборд у оператора, наблюдателя и директора (OPR-31)', () => {
    const expected: Record<Role, string> = {
      manufacturer: '/profile',
      expert: '/reviews',
      administrator: '/admin/accounts',
      director: '/dashboard',
      operator: '/dashboard',
      observer: '/dashboard',
    };
    for (const role of ROLES) expect(roleHome(role), role).toBe(expected[role]);
  });
  it('стартовая страница разрешена роли матрицей прав (GEN-08)', () => {
    const allowed = (role: Role, path: string): boolean => {
      switch (path) {
        case '/dashboard':
          return can(role, 'dashboard.read') !== null;
        case '/catalog':
          return can(role, 'catalog.search') !== null;
        case '/profile':
          return can(role, 'profile.edit') !== null;
        case '/reviews':
          return can(role, 'review.take') !== null;
        case '/admin/accounts':
          return can(role, 'accounts.manage') !== null;
        case '/account':
          return true; // своя учётная запись: действия в матрице нет, открыта каждой роли
        default:
          return false;
      }
    };
    for (const role of ROLES) expect(allowed(role, roleHome(role)), `${role} → ${roleHome(role)}`).toBe(true);
  });
});

/**
 * Страница после входа — одно правило для сервера и интерфейса (OPR-31, GEN-08): сохранённый
 * локальный адрес, если роль вправе открыть страницу, иначе стартовая страница роли.
 */
describe('страница после входа: destinationFor', () => {
  const guarded: [string, Action][] = [
    ['/catalog', 'catalog.search'],
    ['/dashboard', 'dashboard.read'],
    ['/profile', 'profile.edit'],
    ['/reviews', 'review.take'],
    ['/admin/accounts', 'accounts.manage'],
  ];

  it.each(ROLES)('без сохранённого адреса %s попадает на стартовую страницу', (role) => {
    for (const saved of [undefined, null, '', '/', '/?x=1', '/#top'])
      expect(destinationFor(role, saved), String(saved)).toBe(roleHome(role));
  });

  it.each(ROLES)('страница по праву матрицы: %s на /catalog, /dashboard, /profile, /reviews, /admin/accounts', (role) => {
    for (const [path, action] of guarded) {
      const allowed = can(role, action) !== null;
      for (const saved of [path, `${path}?q=steel&page=2#results`, `${path}/`, `${path}//`, `${path}/123?tab=docs`])
        expect(destinationFor(role, saved), saved).toBe(allowed ? saved : roleHome(role));
    }
  });

  it('/profile только у производителя: у остальных ролей — стартовая страница', () => {
    for (const role of ROLES)
      expect(destinationFor(role, '/profile?tab=main'), role).toBe(
        role === 'manufacturer' ? '/profile?tab=main' : roleHome(role),
      );
  });

  it('/reviews — только SME, остальные на стартовую', () => {
    for (const role of ROLES)
      for (const saved of ['/reviews', '/reviews?status=submitted', '/reviews/', '/reviews/x'])
        expect(destinationFor(role, saved), `${role} ${saved}`).toBe(role === 'expert' ? saved : roleHome(role));
    expect(destinationFor('director', '/reviews')).toBe('/dashboard');
    expect(destinationFor('administrator', '/reviews')).toBe('/admin/accounts');
    // Путь сравнивается декодированным, как у роутера.
    expect(destinationFor('operator', '/%72eviews')).toBe('/dashboard');
  });

  it('/admin/accounts — только администратор', () => {
    for (const role of ROLES)
      for (const saved of ['/admin/accounts', '/admin/accounts/', '/admin/accounts/x?y'])
        expect(destinationFor(role, saved), `${role} ${saved}`).toBe(role === 'administrator' ? saved : roleHome(role));
    expect(destinationFor('expert', '/admin/accounts')).toBe('/reviews');
    expect(destinationFor('manufacturer', '/admin/accounts')).toBe('/profile');
    // Путь сравнивается декодированным, как у роутера.
    expect(destinationFor('operator', '/admin/%61ccounts')).toBe('/dashboard');
    // Свою учётную запись администратор по-прежнему открывает.
    expect(destinationFor('administrator', '/account')).toBe('/account');
  });

  it('/companies/<id>: открыт ролям с catalog.search, производитель и администратор уходят на стартовую (GEN-08)', () => {
    for (const role of ROLES) {
      const allowed = can(role, 'catalog.search') !== null;
      for (const saved of ['/companies/x?y', '/companies', '/companies/'])
        expect(destinationFor(role, saved), `${role} ${saved}`).toBe(allowed ? saved : roleHome(role));
    }
    expect(destinationFor('manufacturer', '/companies/x?y')).toBe('/profile');
    expect(destinationFor('administrator', '/companies/x?y')).toBe('/admin/accounts');
    // Путь сравнивается декодированным, как у роутера.
    expect(destinationFor('manufacturer', '/%63ompanies/x')).toBe('/profile');
  });

  it('страница сравнивается по сегментам: вложенный путь — та же страница, похожее имя — нет', () => {
    // Роль с правом сохраняет вложенный адрес каталога.
    expect(destinationFor('operator', '/catalog/123')).toBe('/catalog/123');
    expect(destinationFor('expert', '/catalog/123?tab=docs')).toBe('/catalog/123?tab=docs');
    // Роль без права уходит на стартовую страницу и с вложенного адреса.
    expect(destinationFor('manufacturer', '/catalog/123')).toBe('/profile');
    expect(destinationFor('administrator', '/catalog/123')).toBe('/admin/accounts');
    expect(destinationFor('expert', '/dashboard/x')).toBe('/reviews');
    expect(destinationFor('operator', '/profile/edit')).toBe('/dashboard');
    // Другое имя страницы — не каталог и не дашборд: его разбирает маршрутизатор («не найдено»).
    expect(destinationFor('manufacturer', '/catalogue')).toBe('/catalogue');
    expect(destinationFor('expert', '/dashboards')).toBe('/dashboards');
    // Регистр не меняется: маршруты SPA чувствительны к регистру, /CATALOG — «не найдено».
    expect(destinationFor('manufacturer', '/CATALOG')).toBe('/CATALOG');
    expect(destinationFor('operator', '/account')).toBe('/account');
    expect(destinationFor('manufacturer', '/account')).toBe('/account');
  });

  it.each(ROLES)('страницы входа ведут %s на стартовую страницу', (role) => {
    for (const saved of [
      '/login',
      '/login/',
      '/login?error=session_expired',
      '/register',
      '/register/',
      '/auth/',
      '/auth/verify?returnTo=%2Fcatalog',
      '/auth/responsibility',
    ])
      expect(destinationFor(role, saved), saved).toBe(roleHome(role));
  });

  it.each([
    '//outside.invalid',
    '/\\outside.invalid',
    '/%5coutside.invalid',
    '/\n/outside.invalid',
    'https://outside.invalid',
    'javascript:alert(1)',
    '/%0a/outside.invalid',
    42,
    { pathname: '/catalog' },
  ])('внешний или небезопасный адрес %s ведёт на стартовую страницу', (saved) => {
    for (const role of ROLES) expect(destinationFor(role, saved), role).toBe(roleHome(role));
  });

  it('путь сравнивается декодированным, как его сопоставляет React Router; адрес возвращается как был', () => {
    expect(destinationFor('manufacturer', '/%63atalog')).toBe('/profile');
    expect(destinationFor('administrator', '/%63atalog/123')).toBe('/admin/accounts');
    expect(destinationFor('expert', '/%64ashboard')).toBe('/reviews');
    expect(destinationFor('operator', '/%70rofile')).toBe('/dashboard');
    expect(destinationFor('operator', '/%6Cogin')).toBe('/dashboard');
    // Роль с правом получает исходный адрес без перекодирования.
    expect(destinationFor('operator', '/%63atalog?q=%D1%82')).toBe('/%63atalog?q=%D1%82');
  });

  it('декодирование однократное и посегментное: двойное кодирование и закодированный слеш — не каталог', () => {
    expect(destinationFor('manufacturer', '/%2563atalog')).toBe('/%2563atalog');
    expect(destinationFor('manufacturer', '/catalog%2F123')).toBe('/catalog%2F123');
    // Закодированный слеш не превращает локальный путь во внешний адрес.
    for (const role of ROLES) {
      const target = destinationFor(role, '/%2F%2Fevil.example');
      expect(target, role).toBe('/%2F%2Fevil.example');
      expect(new URL(target, 'https://imbc.invalid').origin, role).toBe('https://imbc.invalid');
    }
  });

  it('битая кодировка не роняет правило: путь сравнивается как есть', () => {
    expect(() => destinationFor('manufacturer', '/%E0%A4%A')).not.toThrow();
    expect(destinationFor('manufacturer', '/%E0%A4%A')).toBe('/%E0%A4%A');
    expect(destinationFor('manufacturer', '/catalog/%E0%A4%A')).toBe('/profile');
    expect(destinationFor('operator', '/catalog/%E0%A4%A')).toBe('/catalog/%E0%A4%A');
  });

  it('адрес нормализуется так же, как в safeReturnTo', () => {
    expect(destinationFor('manufacturer', '/catalog/../profile?tab=main#section')).toBe('/profile?tab=main#section');
    expect(destinationFor('manufacturer', '/account/../catalog')).toBe('/profile');
  });
});
