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

function validHttpUrl(value?: string | null): boolean {
  if (!value) return false;

  const raw = value.trim();

  if (!raw) return false;

  // Reject HTML fragments / malformed values stored as URLs.
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

export function getActionableContactType(
  curator: CuratorContactInput
): ActionableContactType {
  const email = String(curator.email || "").trim();

  if (email && email.includes("@")) {
    return "EMAIL";
  }

  if (validHttpUrl(curator.submissionUrl)) {
    return "SUBMISSION";
  }

  if (
    validHttpUrl(curator.instagramUrl) &&
    /(^|\.)instagram\.com$/i.test(
      new URL(curator.instagramUrl!).hostname.replace(/^www\./i, "")
    )
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