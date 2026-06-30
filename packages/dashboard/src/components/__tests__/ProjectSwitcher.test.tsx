// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  active: null as string | null,
  list: [] as Array<{ project: { id: string; orgId: string; name: string; slug: string }; role: string }>,
  setSpy: vi.fn(),
}));

vi.mock('../../api/projects', () => ({
  getProjects: () => Promise.resolve(h.list),
  getActiveProjectId: () => h.active,
  setActiveProjectId: (id: string | null) => {
    h.active = id;
    h.setSpy(id);
  },
}));

import { ProjectSwitcher } from '../ProjectSwitcher';

const P = (id: string, name: string) => ({ project: { id, orgId: 'o', name, slug: id }, role: 'member' });

beforeEach(() => {
  h.active = null;
  h.list = [];
  h.setSpy.mockClear();
  Object.defineProperty(window, 'location', { configurable: true, writable: true, value: { reload: vi.fn() } });
});

describe('ProjectSwitcher (#244)', () => {
  it('defaults to the first project and hides when only one is accessible', async () => {
    h.list = [P('a', 'Alpha')];
    const { container } = render(<ProjectSwitcher />);
    await waitFor(() => expect(h.setSpy).toHaveBeenCalledWith('a'));
    expect(container.querySelector('button')).toBeNull(); // nothing to switch
  });

  it('shows the active project, lists all on open, and persists + reloads on select', async () => {
    h.active = 'a';
    h.list = [P('a', 'Alpha'), P('b', 'Beta')];
    render(<ProjectSwitcher />);

    fireEvent.click(await screen.findByRole('button', { name: /Alpha/ }));
    expect(screen.getByRole('menuitemradio', { name: 'Beta' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Beta' }));
    expect(h.setSpy).toHaveBeenCalledWith('b');
    expect(window.location.reload).toHaveBeenCalled();
  });

  it('recovers to the first accessible project (and reloads) when the active one is revoked', async () => {
    h.active = 'gone';
    h.list = [P('a', 'Alpha'), P('b', 'Beta')];
    render(<ProjectSwitcher />);
    await waitFor(() => expect(h.setSpy).toHaveBeenCalledWith('a'));
    expect(window.location.reload).toHaveBeenCalled();
  });

  it('closes the menu on Escape', async () => {
    h.active = 'a';
    h.list = [P('a', 'Alpha'), P('b', 'Beta')];
    render(<ProjectSwitcher />);
    fireEvent.click(await screen.findByRole('button', { name: /Alpha/ }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
