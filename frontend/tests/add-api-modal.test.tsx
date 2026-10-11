import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddApiModal } from '../src/components/Dashboard/AddApiModal';
import type { CreateMonitorInput } from '../src/api/types';

const defaults = { defaultInterval: '5m', defaultTimeout: 5000, defaultEnvironment: 'Production' as const, alertSlack: false, alertEmail: false, alertPagerDuty: false, ssrfProtection: false, autoBaseline: true };

function mockFetch(responder: (url: string, init?: RequestInit) => { status: number; body: unknown }) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = url.startsWith('/api/demo/catalog') ? { status: 200, body: { data: { driftAfterMs: 120000, endpoints: [] } } } : responder(url, init);
    return Promise.resolve(new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } }));
  }));
  return calls;
}

describe('AddApiModal', () => {
  it('tests the connection through the backend and shows the real preview', async () => {
    const calls = mockFetch(() => ({ status: 200, body: { data: { outcome: 'SUCCESS', status: 200, latencyMs: 87, bytes: 120, parseOutcome: 'JSON', contentType: 'application/json', preview: { id: 1, name: 'Aman' }, error: null, blocked: false, reason: null, safe: true, fieldCount: 2 } } }));
    render(<AddApiModal isOpen onClose={() => undefined} onAddApi={() => Promise.resolve(true)} showToast={() => undefined} defaults={defaults} actor="alice" />);
    await userEvent.clear(screen.getByLabelText(/Endpoint URL/));
    await userEvent.type(screen.getByLabelText(/Endpoint URL/), 'https://api.example.com/users/1');
    await userEvent.click(screen.getByRole('button', { name: /Test Connection/ }));
    await waitFor(() => expect(screen.getByTestId('test-result')).toBeInTheDocument());
    expect(screen.getByTestId('test-result').textContent).toContain('HTTP 200');
    expect(screen.getByTestId('test-result').textContent).toContain('"name": "Aman"');
    const call = calls.find((c) => c.url.startsWith('/api/monitors/test'));
    expect(call).toBeDefined();
    expect(JSON.parse(String(call?.init?.body))).toMatchObject({ url: 'https://api.example.com/users/1', method: 'GET', authType: 'NONE', timeoutMs: 5000 });
  });

  it('shows the SSRF block reason returned by the backend', async () => {
    mockFetch(() => ({ status: 200, body: { data: { outcome: 'BLOCKED', status: null, latencyMs: 0, bytes: 0, parseOutcome: 'NOT_READ', contentType: null, preview: null, error: '127.0.0.1 is a loopback address; private destinations are blocked by the SSRF guard', blocked: true, reason: '127.0.0.1 is a loopback address; private destinations are blocked by the SSRF guard', safe: false, fieldCount: 0 } } }));
    render(<AddApiModal isOpen onClose={() => undefined} onAddApi={() => Promise.resolve(true)} showToast={() => undefined} defaults={defaults} actor="alice" />);
    await userEvent.clear(screen.getByLabelText(/Endpoint URL/));
    await userEvent.type(screen.getByLabelText(/Endpoint URL/), 'http://127.0.0.1:3000/mock/x');
    await userEvent.click(screen.getByRole('button', { name: /Test Connection/ }));
    await waitFor(() => expect(screen.getByTestId('test-result').textContent).toContain('loopback'));
  });

  it('submits the typed payload including the secret for bearer auth and the interval in seconds', async () => {
    const onAddApi = vi.fn((_: CreateMonitorInput) => Promise.resolve(true));
    // Saving an untested URL asks for confirmation; accept it.
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<AddApiModal isOpen onClose={() => undefined} onAddApi={onAddApi} showToast={() => undefined} defaults={defaults} actor="alice" />);
    await userEvent.type(screen.getByLabelText(/API Name/), 'User API');
    await userEvent.clear(screen.getByLabelText(/Endpoint URL/));
    await userEvent.type(screen.getByLabelText(/Endpoint URL/), 'https://api.example.com/users/1');
    await userEvent.selectOptions(screen.getByLabelText('Authentication type'), 'Bearer Token');
    await userEvent.type(screen.getByLabelText('Secret'), 'sk-test');
    await userEvent.selectOptions(screen.getByLabelText(/Monitoring Interval/), '1m');
    await userEvent.click(screen.getByRole('button', { name: /Save API Configuration/ }));
    await waitFor(() => expect(onAddApi).toHaveBeenCalled());
    expect(onAddApi.mock.calls[0]?.[0]).toMatchObject({ name: 'User API', url: 'https://api.example.com/users/1', authType: 'BEARER', authSecret: 'sk-test', intervalSec: 60, autoBaseline: true, createdBy: 'alice' });
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/not tested this exact URL/));
  });
});
