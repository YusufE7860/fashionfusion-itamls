/**
 * Helpdesk adapters. Each maps an external ticketing system's "recently updated"
 * feed to a common shape we can store in helpdesk_links.
 *
 * Phase 1 supports Freshservice and Jira Service Management out of the box,
 * plus a "stub" mode that returns canned tickets so the rest of the system can
 * be developed/demoed without a real connection.
 */

export interface NormalisedTicket {
  externalId: string;
  system: string;        // FRESHSERVICE | JIRA_SM | STUB
  summary: string;
  openedAtIso: string;
  closedAtIso?: string;
  /** Best-guess asset tag found anywhere in the ticket (subject / description / asset field). */
  assetTagHint?: string;
}

export interface HelpdeskAdapter {
  name: string;
  fetchRecent(sinceIso: string): Promise<NormalisedTicket[]>;
}

// ---------- Stub adapter (for demo / offline use) ----------
class StubAdapter implements HelpdeskAdapter {
  name = 'STUB';
  async fetchRecent(): Promise<NormalisedTicket[]> {
    const now = new Date();
    return [
      {
        externalId: 'STUB-1001',
        system: this.name,
        summary: 'Store 001 — POS PC FF-POS-G-001 not powering on',
        openedAtIso: new Date(now.getTime() - 3600_000).toISOString(),
        assetTagHint: 'FF-POS-G-001',
      },
      {
        externalId: 'STUB-1002',
        system: this.name,
        summary: 'Store 002 — Slip printer paper jam',
        openedAtIso: new Date(now.getTime() - 7200_000).toISOString(),
      },
    ];
  }
}

// ---------- Freshservice ----------
class FreshserviceAdapter implements HelpdeskAdapter {
  name = 'FRESHSERVICE';
  constructor(private domain: string, private apiKey: string) {}
  async fetchRecent(sinceIso: string): Promise<NormalisedTicket[]> {
    const url = `https://${this.domain}/api/v2/tickets?updated_since=${encodeURIComponent(sinceIso)}&per_page=100`;
    const auth = Buffer.from(`${this.apiKey}:X`).toString('base64');
    const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
    if (!res.ok) throw new Error(`Freshservice ${res.status}`);
    const body: any = await res.json();
    const tickets = body.tickets ?? [];
    return tickets.map((t: any) => ({
      externalId: String(t.id),
      system: this.name,
      summary: t.subject,
      openedAtIso: t.created_at,
      closedAtIso: t.status === 5 ? t.updated_at : undefined,
      assetTagHint: extractTag(`${t.subject} ${t.description_text ?? ''}`),
    }));
  }
}

// ---------- Jira Service Management ----------
class JiraSmAdapter implements HelpdeskAdapter {
  name = 'JIRA_SM';
  constructor(private domain: string, private email: string, private apiToken: string, private jql: string) {}
  async fetchRecent(sinceIso: string): Promise<NormalisedTicket[]> {
    const jql = `${this.jql ? `(${this.jql}) AND ` : ''}updated >= "${sinceIso.slice(0,10)} 00:00"`;
    const url = `https://${this.domain}/rest/api/3/search?jql=${encodeURIComponent(jql)}&fields=summary,created,resolutiondate,status`;
    const auth = Buffer.from(`${this.email}:${this.apiToken}`).toString('base64');
    const res = await fetch(url, { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Jira ${res.status}`);
    const body: any = await res.json();
    const issues = body.issues ?? [];
    return issues.map((i: any) => ({
      externalId: i.key,
      system: this.name,
      summary: i.fields?.summary ?? '',
      openedAtIso: i.fields?.created,
      closedAtIso: i.fields?.resolutiondate ?? undefined,
      assetTagHint: extractTag(i.fields?.summary ?? ''),
    }));
  }
}

const TAG_RE = /\bFF-[A-Z0-9]{2,}-?[A-Z0-9-]+\b/;
function extractTag(text: string) {
  const m = text?.match?.(TAG_RE);
  return m?.[0];
}

export function buildAdapter(): HelpdeskAdapter {
  const system = (process.env.HELPDESK_SYSTEM ?? 'STUB').toUpperCase();
  if (system === 'FRESHSERVICE') {
    return new FreshserviceAdapter(
      process.env.HELPDESK_DOMAIN ?? '',
      process.env.HELPDESK_API_KEY ?? '',
    );
  }
  if (system === 'JIRA_SM') {
    return new JiraSmAdapter(
      process.env.HELPDESK_DOMAIN ?? '',
      process.env.HELPDESK_EMAIL ?? '',
      process.env.HELPDESK_API_TOKEN ?? '',
      process.env.HELPDESK_JQL ?? 'project = "IT"',
    );
  }
  return new StubAdapter();
}
