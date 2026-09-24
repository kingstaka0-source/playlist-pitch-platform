export type ActionableContactType =
  | "EMAIL"
  | "SUBMISSION"
  | "INSTAGRAM"
  | "NONE";

export type CuratorContactInput = {
  email?: string | null;
  submissionUrl?: string | null;
  instagramUrl?: string | null;
  websiteUrl?: string | null;
  contactConfidence?: number | null;
};

export type ExtractedCuratorContact = {
  email: string | null;
  submissionUrl: string | null;
  instagramUrl: string | null;
  websiteUrl: string | null;
  contactConfidence: number;
};

export function normalizeCuratorEmail(email: string): string {
  return email.trim().toLowerCase();
}

function uniq<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function isAsset(value: string): boolean {
  return /\.(png|jpg|jpeg|webp|svg|gif|css|js|ico|pdf)(\?.*)?$/i.test(value);
}

export function isBadCuratorEmail(email: string): boolean {
  const e = normalizeCuratorEmail(email);

  if (!e.includes("@")) return true;
  if (isAsset(e)) return true;

  const blockedExact = new Set([
    "error-lite@duckduckgo.com",
  ]);

  if (blockedExact.has(e)) return true;

  const blockedPrefixes = [
    "noreply@",
    "no-reply@",
    "privacy@",
    "support@",
    "help@",
    "legal@",
    "abuse@",
    "admin@",
    "hello@spotify.com",
    "info@spotify.com",
  ];

  if (blockedPrefixes.some((prefix) => e.startsWith(prefix))) {
    return true;
  }

  const blockedDomains = new Set([
    "duckduckgo.com",
    "google.com",
    "bing.com",
    "yahoo.com",
    "spotify.com",
    "instagram.com",
    "facebookmail.com",
    "example.com",
    "test.com",
    "email.com",
  ]);

  const domain = e.split("@")[1] || "";

  return blockedDomains.has(domain);
}

export function extractCuratorEmails(text: string): string[] {
  if (!text) return [];

  const matches =
    text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];

  return uniq(
    matches
      .map(normalizeCuratorEmail)
      .filter((email) => !isBadCuratorEmail(email))
  );
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x2F;/gi, "/")
    .replace(/&#47;/g, "/")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}

export function extractCuratorUrls(text: string): string[] {
  if (!text) return [];

  const decoded = decodeHtmlEntities(text);

  const matches =
    decoded.match(/https?:\/\/[^\s<>"')\]]+/gi) ||
    decoded.match(/www\.[^\s<>"')\]]+/gi) ||
    [];

  return uniq(
    matches
      .map((url) => {
        const trimmed = url.trim().replace(/[),.;]+$/, "");

        if (/^www\./i.test(trimmed)) {
          return `https://${trimmed}`;
        }

        return trimmed;
      })
      .filter(Boolean)
  );
}

function validHttpUrl(value?: string | null): boolean {
  if (!value) return false;

  const raw = value.trim();

  if (!raw) return false;

  if (/[<>"']/.test(raw)) return false;

  try {
    const url = new URL(raw);

    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      Boolean(url.hostname)
    );
  } catch {
    return false;
  }
}

function looksLikeInstagram(url: string): boolean {
  if (!validHttpUrl(url)) return false;

  try {
    const host = new URL(url).hostname
      .toLowerCase()
      .replace(/^www\./, "");

    return host === "instagram.com" || host.endsWith(".instagram.com");
  } catch {
    return false;
  }
}

function looksLikeSubmission(url: string): boolean {
  if (!validHttpUrl(url)) return false;

  return /submit|submission|pitch|form|google\.com\/forms|forms\.gle|typeform|airtable/i.test(
    url
  );
}

function looksLikeLinktree(url: string): boolean {
  return /linktr\.ee|beacons\.ai|bio\.site|lnk\.bio/i.test(url);
}

function looksLikeWebsite(url: string): boolean {
  if (!validHttpUrl(url)) return false;

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");

    const blockedHosts = [
      "spotify.com",
      "youtube.com",
      "youtu.be",
      "instagram.com",
      "forms.gle",
      "docs.google.com",
      "typeform.com",
      "airtable.com",
    ];

    const blocked = blockedHosts.some(
      (domain) => host === domain || host.endsWith(`.${domain}`)
    );

    return !blocked && !looksLikeSubmission(url);
  } catch {
    return false;
  }
}

export function extractCuratorContactFromDescription(
  description: string
): ExtractedCuratorContact {
  const emails = extractCuratorEmails(description);
  const urls = extractCuratorUrls(description);

  const email = emails[0] || null;

  const instagramUrl =
    urls.find((url) => looksLikeInstagram(url)) || null;

  const submissionUrl =
    urls.find((url) => looksLikeSubmission(url)) || null;

  const rawWebsite =
    urls.find(
      (url) => looksLikeWebsite(url) && !looksLikeSubmission(url)
    ) || null;

  const websiteUrl =
    rawWebsite && !looksLikeLinktree(rawWebsite)
      ? rawWebsite
      : null;

  let contactConfidence = 0;

  if (email) {
    if (submissionUrl) contactConfidence = 90;
    else if (websiteUrl) contactConfidence = 85;
    else if (instagramUrl) contactConfidence = 75;
    else contactConfidence = 70;
  } else if (submissionUrl) {
    contactConfidence = 45;
  } else if (instagramUrl || websiteUrl) {
    contactConfidence = 35;
  }

  return {
    email,
    submissionUrl,
    instagramUrl,
    websiteUrl,
    contactConfidence,
  };
}

export function getActionableContactType(
  curator: CuratorContactInput
): ActionableContactType {
  const email = normalizeCuratorEmail(
    String(curator.email || "")
  );

  if (email && !isBadCuratorEmail(email)) {
    return "EMAIL";
  }

  if (validHttpUrl(curator.submissionUrl)) {
    return "SUBMISSION";
  }

  if (
    curator.instagramUrl &&
    looksLikeInstagram(curator.instagramUrl)
  ) {
    return "INSTAGRAM";
  }

  return "NONE";
}

export function isActionableCurator(
  curator: CuratorContactInput
): boolean {
  return getActionableContactType(curator) !== "NONE";
}