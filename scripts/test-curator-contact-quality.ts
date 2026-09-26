import {
  extractCuratorContactFromDescription,
  getActionableContactType,
  isActionableCurator,
} from "../src/lib/curatorContactQuality";

const tests = [
  {
    name: "email",
    input: { email: "music@curator.com" },
    expected: "EMAIL",
  },
  {
    name: "submission",
    input: { submissionUrl: "https://curator.com/submit" },
    expected: "SUBMISSION",
  },
  {
    name: "instagram",
    input: { instagramUrl: "https://www.instagram.com/curator/" },
    expected: "INSTAGRAM",
  },
  {
    name: "website only",
    input: { websiteUrl: "https://curator.com" },
    expected: "NONE",
  },
  {
    name: "spotify is not contact",
    input: { websiteUrl: "https://open.spotify.com/playlist/test" },
    expected: "NONE",
  },
  {
    name: "malformed submission",
    input: { submissionUrl: 'https://curator.com/submit">Submit</a>' },
    expected: "NONE",
  },
  {
    name: "malformed instagram",
    input: { instagramUrl: 'https://instagram.com/curator">Instagram</a>' },
    expected: "NONE",
  },
  {
    name: "no contact",
    input: {},
    expected: "NONE",
  },
];

let failed = 0;

for (const test of tests) {
  const actual = getActionableContactType(test.input);
  const actionable = isActionableCurator(test.input);
  const passed = actual === test.expected;

  if (!passed) failed++;

  console.log(
    `${passed ? "PASS" : "FAIL"} | ${test.name} | expected=${test.expected} actual=${actual} actionable=${actionable}`
  );
}

if (failed > 0) {
  throw new Error(`${failed} contact-quality test(s) failed`);
}

console.log("\nALL CONTACT QUALITY TESTS PASSED");
console.log("\n=== DESCRIPTION EXTRACTION TESTS ===");

const descriptionCases = [
  {
    name: "email",
    description: "Submit your music: curator@examplemusic.nl",
    expected: "EMAIL",
  },
  {
    name: "submission",
    description: "Submit here: https://examplemusic.nl/submit",
    expected: "SUBMISSION",
  },
  {
    name: "instagram",
    description: "DM us: https://instagram.com/examplecurator",
    expected: "INSTAGRAM",
  },
  {
    name: "website only",
    description: "Website: https://examplemusic.nl",
    expected: "NONE",
  },
  {
    name: "html encoded submission",
    description: "Submit: https:&#x2F;&#x2F;examplemusic.nl&#x2F;submit",
    expected: "SUBMISSION",
  },
  {
    name: "bad spotify email",
    description: "Contact: hello@spotify.com",
    expected: "NONE",
  },
  {
    name: "pitchfork article is not submission",
    description:
      "Read: http://pitchfork.com/features/lists-and-guides/10022-the-50-best-dancehall-songs-of-all-time/",
    expected: "NONE",
  },
  {
    name: "spotify playlist is not website",
    description:
      "Playlist: https://open.spotify.com/playlist/4csIMGPI3aGo3Xy7WG8jBi",
    expected: "NONE",
  },
  {
    name: "youtube channel is not website",
    description:
      "Channel: https://www.youtube.com/channel/UCnQjetFoixgq9lwvIyolC_Q",
    expected: "NONE",
  },
  {
    name: "amazon product is not website",
    description:
      "Buy: https://www.amazon.co.uk/dp/B00TTCK6TU",
    expected: "NONE",
  },
  {
    name: "123rf asset is not website",
    description:
      "Image: https://www.123rf.com/profile_virtosmedia",
    expected: "NONE",
  },
  {
    name: "real submithub page is submission",
    description:
      "Submit: https://www.submithub.com/playlister/slaeylcetti",
    expected: "SUBMISSION",
  },
  {
    name: "forms gle is submission",
    description:
      "Submit: https://forms.gle/AbCdEf123",
    expected: "SUBMISSION",
  },
  {
    name: "html encoded instagram",
    description:
      "Instagram: https://www.instagram.com&#x2F;yuri.mdmax",
    expected: "INSTAGRAM",
  },
  {
    name: "sbmt is submission",
    description:
      "Submit: https://sbmt.to/alex-swank",
    expected: "SUBMISSION",
  },
  {
    name: "sbmt subdomain is submission",
    description:
      "Submit: https://ifc.sbmt.to",
    expected: "SUBMISSION",
  },
  {
    name: "submityourtrack is submission",
    description:
      "Submit: https://submityourtrack.net",
    expected: "SUBMISSION",
  },
];

let extractionFailed = 0;

for (const test of descriptionCases) {
  const contact = extractCuratorContactFromDescription(test.description);
  const actual = getActionableContactType(contact);
  const passed = actual === test.expected;

  console.log(
    `${passed ? "PASS" : "FAIL"} | ${test.name} | expected=${test.expected} actual=${actual}`
  );

  if (!passed) extractionFailed++;
}

if (extractionFailed > 0) {
  throw new Error(
    `${extractionFailed} description extraction test(s) failed`
  );
}

console.log("\nALL DESCRIPTION EXTRACTION TESTS PASSED");
console.log("\n=== WEBSITE REJECTION TESTS ===");

const rejectedWebsiteCases = [
  {
    name: "youtube.be is not website",
    description: "Video: http://Youtube.be",
  },
  {
    name: "bitly is not website",
    description: "Link: https://bit.ly/example",
  },
  {
    name: "tinyurl is not website",
    description: "Link: https://tinyurl.com/example",
  },
  {
    name: "t.ly is not website",
    description: "Link: https://t.ly/example",
  },
  {
    name: "tunemymusic is not curator website",
    description: "Transfer: https://www.tunemymusic.com",
  },
  {
    name: "soundcloud is not curator website",
    description: "Listen: https://on.soundcloud.com/example",
  },
  {
    name: "hearthis is not curator website",
    description: "Listen: https://hearthis.at/example",
  },
];

let websiteRejectionFailed = 0;

for (const test of rejectedWebsiteCases) {
  const contact = extractCuratorContactFromDescription(test.description);
  const passed = contact.websiteUrl === null;

  console.log(
    `${passed ? "PASS" : "FAIL"} | ${test.name} | websiteUrl=${contact.websiteUrl ?? "null"}`
  );

  if (!passed) websiteRejectionFailed++;
}

if (websiteRejectionFailed > 0) {
  throw new Error(
    `${websiteRejectionFailed} website rejection test(s) failed`
  );
}

console.log("\nALL WEBSITE REJECTION TESTS PASSED");
