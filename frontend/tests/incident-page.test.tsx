import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IncidentImpactPage } from '../src/components/Incidents/IncidentImpactPage';
import type { Incident } from '../src/types';

const incident: Incident = {
  id: 'i1', title: 'User API: field renamed (name -> display_name)', apiId: 'm1', apiName: 'User API', issueType: 'Schema drift', severity: 'Critical', status: 'Open', detectedAt: '11 Oct 2026, 11:42 UTC', environment: 'Production', endpoint: 'https://api.example.com/users/1',
  previousResponse: '{\n  "name": "Aman Gupta"\n}', latestResponse: '{\n  "display_name": "Aman Gupta"\n}',
  diffs: [{ fieldName: 'name → display_name', changeType: 'renamed', expected: 'name: "Aman Gupta"', actual: 'display_name: "Aman Gupta"' }],
  affectedFeatures: [{ featureName: 'Profile card', apiName: 'User API', expectedField: 'name', impactLevel: 'Critical', route: '/profile', affectedUsersPercentage: 'field missing', description: 'Reads $.name', userFacingSymptom: 'Welcome, undefined' }],
  registeredMappings: [{ feature: 'Profile card', api: 'User API', jsonPath: '$.name' }],
  proposalId: 'p1', occurrenceCount: 2, assignee: { name: 'Unassigned', role: 'auto-detected' },
};

describe('IncidentImpactPage', () => {
  it('renders the baseline vs latest comparison, diffs and affected features from props', () => {
    render(<IncidentImpactPage incidents={[incident]} onSelectIncident={() => undefined} onSelectProposal={() => undefined} onNavigateSection={() => undefined} onChangeStatus={() => Promise.resolve()} onAddMapping={() => Promise.resolve()} onRequestProposal={() => Promise.resolve()} showToast={() => undefined} />);
    expect(screen.getByText(/"display_name": "Aman Gupta"/)).toBeInTheDocument();
    expect(screen.getByText('name → display_name')).toBeInTheDocument();
    expect(screen.getByText('renamed')).toBeInTheDocument();
    expect(screen.getAllByText('Profile card').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Welcome, undefined/)).toBeInTheDocument();
    expect(screen.getByText(/Seen 2×/)).toBeInTheDocument();
  });

  it('calls the backend handlers for status changes and new mappings', async () => {
    const onChangeStatus = vi.fn(() => Promise.resolve());
    const onAddMapping = vi.fn(() => Promise.resolve());
    render(<IncidentImpactPage incidents={[incident]} onSelectIncident={() => undefined} onSelectProposal={() => undefined} onNavigateSection={() => undefined} onChangeStatus={onChangeStatus} onAddMapping={onAddMapping} onRequestProposal={() => Promise.resolve()} showToast={() => undefined} />);
    await userEvent.selectOptions(screen.getByDisplayValue('Open'), 'Investigating');
    expect(onChangeStatus).toHaveBeenCalledWith('i1', 'Investigating');
    await userEvent.click(screen.getByRole('button', { name: /Map Feature/ }));
    await userEvent.type(screen.getByPlaceholderText('e.g. Checkout Price Summary'), 'Team directory');
    const pathInput = screen.getByPlaceholderText('$.total_amount');
    await userEvent.clear(pathInput);
    await userEvent.type(pathInput, '$.email');
    await userEvent.click(screen.getByRole('button', { name: 'Save Mapping' }));
    expect(onAddMapping).toHaveBeenCalledWith('m1', 'Team directory', '$.email', undefined);
  });

  it('offers to draft a proposal when none exists and explains availability incidents', () => {
    const onRequestProposal = vi.fn(() => Promise.resolve());
    const { rerender } = render(<IncidentImpactPage incidents={[{ ...incident, proposalId: undefined }]} onSelectIncident={() => undefined} onSelectProposal={() => undefined} onNavigateSection={() => undefined} onChangeStatus={() => Promise.resolve()} onAddMapping={() => Promise.resolve()} onRequestProposal={onRequestProposal} showToast={() => undefined} />);
    expect(screen.getByRole('button', { name: /Draft adapter proposal/ })).toBeInTheDocument();
    rerender(<IncidentImpactPage incidents={[{ ...incident, proposalId: undefined, issueType: 'HTTP error' }]} onSelectIncident={() => undefined} onSelectProposal={() => undefined} onNavigateSection={() => undefined} onChangeStatus={() => Promise.resolve()} onAddMapping={() => Promise.resolve()} onRequestProposal={onRequestProposal} showToast={() => undefined} />);
    expect(screen.queryByRole('button', { name: /Draft adapter proposal/ })).toBeNull();
    expect(screen.getByText(/cannot repair an unavailable endpoint/)).toBeInTheDocument();
  });
});
