import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CornerToggleGroup } from './CornerToggleGroup';

function render(stored: string | null) {
  vi.stubGlobal('window', {
    localStorage: { getItem: () => stored, setItem: () => {} },
  });
  return renderToStaticMarkup(
    <CornerToggleGroup side="left" className="view-toggles" label="Map view settings" storageKey="k" icon={<i />}>
      <button type="button">chip</button>
    </CornerToggleGroup>
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('CornerToggleGroup', () => {
  it('starts open, with a button to fold it away', () => {
    const html = render(null);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-label="Hide map view settings"');
    expect(html).not.toContain('corner-toggles--collapsed');
    expect(html).not.toMatch(/corner-toggles__chips"[^>]*hidden/);
  });

  it('comes back folded when it was left folded', () => {
    const html = render('true');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Show map view settings"');
    expect(html).toContain('corner-toggles--collapsed');
    expect(html).toMatch(/corner-toggles__chips"[^>]*hidden/);
  });
});
