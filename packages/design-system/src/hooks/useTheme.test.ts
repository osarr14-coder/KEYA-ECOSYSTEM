import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useTheme } from './useTheme';

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('useTheme (ticket F-051)', () => {
  it('démarre sur "system" sans préférence persistée, aucun data-theme posé', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('system');
    expect(document.documentElement).not.toHaveAttribute('data-theme');
  });

  it('lit une préférence déjà persistée au montage', () => {
    window.localStorage.setItem('keya_theme_preference', 'dark');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  });

  it('setTheme("dark") pose data-theme="dark" sur <html> et persiste en localStorage', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setTheme('dark'));

    expect(result.current.theme).toBe('dark');
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(window.localStorage.getItem('keya_theme_preference')).toBe('dark');
  });

  it('setTheme("system") retire l\'attribut data-theme (laisse prefers-color-scheme décider)', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setTheme('dark'));
    act(() => result.current.setTheme('system'));

    expect(result.current.theme).toBe('system');
    expect(document.documentElement).not.toHaveAttribute('data-theme');
  });

  it('une valeur localStorage invalide/corrompue retombe sur "system", jamais une exception', () => {
    window.localStorage.setItem('keya_theme_preference', 'sepia');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('system');
  });
});
