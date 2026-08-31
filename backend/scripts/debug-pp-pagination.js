require("dotenv").config();
const pp = require("../powerPlatform/client");

const types = [
  "microsoft.powerplatform/environments",
  "microsoft.powerapps/canvasapps",
  "microsoft.powerapps/modeldrivenapps",
  "microsoft.powerautomate/cloudflows",
  "microsoft.copilotstudio/agents",
];

const baseBody = {
  TableName: "PowerPlatformResources",
  Clauses: [
    {
      $type: "where",
      FieldName: "type",
      Operator: "in~",
      Values: types.map((t) => `'${t}'`),
    },
  ],
  Options: { Top: 1000, Skip: 0, SkipToken: "" },
};

function summarize(label, result) {
  const data = result.data || [];
  console.log(`\n${label}`);
  console.log("  count:", result.count);
  console.log("  totalRecords:", result.totalRecords);
  console.log("  resultTruncated:", result.resultTruncated);
  console.log("  rows:", data.length);
  console.log("  skipToken length:", (result.skipToken || "").length);
  console.log("  first:", data[0]?.name, data[0]?.type);
  console.log("  last:", data[data.length - 1]?.name, data[data.length - 1]?.type);
}

(async () => {
  const r1 = await pp.queryResources(baseBody);
  summarize("Page 1 (Skip=0)", r1);

  const attempts = [
    ["Page 2 Options.SkipToken", { ...baseBody, Options: { Top: 1000, Skip: 0, SkipToken: r1.skipToken } }],
    ["Page 2 Options.Skip=1000", { ...baseBody, Options: { Top: 1000, Skip: 1000, SkipToken: "" } }],
    ["Page 2 top-level skipToken", { ...baseBody, skipToken: r1.skipToken, Options: { Top: 1000, Skip: 0, SkipToken: r1.skipToken } }],
  ];

  for (const [label, body] of attempts) {
    const r = await pp.queryResources(body);
    summarize(label, r);
  }
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exitCode = 1;
});
