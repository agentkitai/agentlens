// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const h = vi.hoisted(() => ({ connections: [] as Array<Record<string, unknown>> }));
vi.mock('../../api/llm-connections', () => ({
  listConnections: () => Promise.resolve({ connections: h.connections }),
}));
vi.mock('../../api/playground', () => ({ runPlayground: vi.fn() }));

import { Playground } from '../Playground';

const conn = (id: string) => ({ id, provider: 'openai', name: id, keyLast4: '1234', defaultModel: 'gpt-4o-mini' });
const selects = (c: HTMLElement) => [...c.querySelectorAll('select')] as HTMLSelectElement[];

afterEach(cleanup);

describe('Playground connection auto-select', () => {
  it('pre-selects the sole connection in both variant panels', async () => {
    h.connections = [conn('c1')];
    const { container } = render(<MemoryRouter><Playground /></MemoryRouter>);
    // Both variant selects settle on the only connection (waitFor covers the
    // load → effect tick). If auto-select breaks, they stay '' and this times out.
    await waitFor(() => expect(selects(container).map((s) => s.value)).toEqual(['c1', 'c1']));
  });
});
