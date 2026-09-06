import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VersionBadge } from './VersionBadge';

vi.mock('../lib/api', () => ({
  fetchVersionInfo: vi.fn().mockResolvedValue({ version: 'v0.63.0', build_date: '', git_sha: '' }),
}));

describe('VersionBadge', () => {
  it('renders nothing until the version arrives', () => {
    expect(renderToStaticMarkup(<VersionBadge />)).toBe('');
  });
});
