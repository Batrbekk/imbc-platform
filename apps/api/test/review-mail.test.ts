import { LOCALES, SECTION_KINDS } from '@imbc/contracts';
import { describe, expect, it } from 'vitest';
import { renderNotification } from '../src/mail/templates.js';

const sections = SECTION_KINDS.map((kind) => ({
  kind,
  outcome: 'verified',
  comment: null,
  reviewRequired: true,
  publication: 'published',
}));
const notificationSections = (mode: string, items: unknown) =>
  Array.isArray(items)
    ? items.map((section) => ({
        ...section,
        notificationRelevant:
          mode === 'verified_changes' ? section.publication !== 'unchanged' : section.outcome === 'rejected',
      }))
    : items;
const render = (mode: string, status: string, items: unknown = sections) =>
  renderNotification('NOT-05', 'en', {
    mode,
    status,
    sections: JSON.stringify(notificationSections(mode, items)),
    link: 'https://imbc.local/profile',
  });

describe('actual review mail templates NOT-27/28/29', () => {
  it('renders initial verification and one returned result with each changed rejection comment only', () => {
    expect(render('initial', 'verified').text).toContain('Your profile has been verified.');
    const comments = ['First rejection <script>attack</script>\nSecond line', 'Second rejection'];
    const rejected = sections.map((section, index) =>
      index < 2 ? { ...section, outcome: 'rejected', comment: comments[index], publication: 'rejected' } : section,
    );
    const mail = render('resubmit', 'returned', rejected);
    expect(mail.text).toContain('returned for correction');
    for (const comment of comments) expect(mail.text).toContain(comment);
    expect(mail.html).toContain('&lt;script&gt;attack&lt;/script&gt;<br>Second line');
    expect(mail.html).not.toContain('<script>');
    expect(mail.text).not.toContain('Accepted:');
  });
  it('names changed accepted/rejected sections without saying a verified profile was returned', () => {
    const changed = sections.map((section, index) =>
      index === 0
        ? section
        : index === 1
          ? { ...section, outcome: 'rejected', comment: 'Please correct the contact', publication: 'rejected' }
          : { ...section, reviewRequired: false, publication: 'unchanged' },
    );
    const mail = render('verified_changes', 'verified', changed);
    expect(mail.text).toContain('remains Verified');
    expect(mail.text).toContain('Accepted: Main information');
    expect(mail.text).toContain('Rejected: Contacts. Comment: Please correct the contact');
    expect(mail.text).not.toContain('returned');
    expect(mail.text).not.toContain('Personnel');
  });
  it('does not claim publication when accepted related changes still retain older verified values', () => {
    const retained = sections.map((section, index) =>
      index === 0
        ? { ...section, publication: 'retained' }
        : { ...section, reviewRequired: false, publication: 'unchanged' },
    );
    expect(render('verified_changes', 'verified', retained).text).toContain(
      'Previously verified values remain visible',
    );
  });
  it('includes a kept rejected decision and its original comment after Unlock even when no new review is required', () => {
    const retained = sections.map((section, index) => ({
      ...section,
      reviewRequired: false,
      ...(index === 1
        ? { outcome: 'rejected', comment: 'Original rejected contact <value>', publication: 'rejected' }
        : {}),
    }));
    const mail = render('resubmit', 'returned', retained);
    expect(mail.text).toContain('Rejected: Contacts. Comment: Original rejected contact <value>');
    expect(mail.html).toContain('Original rejected contact &lt;value&gt;');
    expect(mail.text).not.toContain('Accepted:');
  });
  it('names all pending differences from published values, including decisions kept through Unlock', () => {
    const retained = sections.map((section) => ({
      ...section,
      reviewRequired: false,
      publication: section.kind === 'contacts' ? 'rejected' : section.kind === 'production' ? 'retained' : 'unchanged',
      ...(section.kind === 'contacts' ? { outcome: 'rejected', comment: 'Correct the retained contact' } : {}),
    }));
    const mail = render('verified_changes', 'verified', retained);
    expect(mail.text).toContain('remains Verified');
    expect(mail.text).toContain('Rejected: Contacts. Comment: Correct the retained contact');
    expect(mail.text).toContain('Accepted: Production');
    expect(mail.text).not.toContain('Main information');
    expect(mail.text).not.toContain('Products');
    expect(mail.text).not.toContain('returned');
  });
  it('refuses incomplete/duplicate/mismatched outcomes and never exposes their values in errors', () => {
    for (const invalid of [
      sections.slice(1),
      sections.map(() => sections[0]),
      sections.map((section, index) =>
        index === 0 ? { ...section, outcome: 'rejected', comment: null, publication: 'rejected' } : section,
      ),
    ])
      expect(() => render('initial', 'verified', invalid)).toThrow('invalid review result');
    expect(() => render('verified_changes', 'returned')).toThrow('invalid review result');
    expect(() =>
      renderNotification('NOT-05', 'en', {
        mode: 'verified_changes',
        status: 'verified',
        sections: JSON.stringify(sections.map((section) => ({ ...section, notificationRelevant: false }))),
        link: 'https://imbc.local/profile',
      }),
    ).toThrow('invalid review result');
  });
  it('renders all three workflow codes in every locale with escaped text and app links', () => {
    for (const locale of LOCALES) {
      const result = renderNotification('NOT-05', locale, {
        mode: 'initial',
        status: 'verified',
        sections: JSON.stringify(notificationSections('initial', sections)),
        link: 'https://imbc.local/profile',
      });
      expect(result.html).toContain(`lang="${locale}"`);
      expect(result.text).toContain('https://imbc.local/profile');
      for (const code of ['NOT-04', 'NOT-10'] as const) {
        const mail = renderNotification(code, locale, { name: '<private-name>', link: 'https://imbc.local/reviews' });
        expect(mail.html).toContain('&lt;private-name&gt;');
        expect(mail.text).toContain('https://imbc.local/reviews');
        expect(mail.text).not.toMatch(/\{\w+\}/);
      }
    }
  });
});
