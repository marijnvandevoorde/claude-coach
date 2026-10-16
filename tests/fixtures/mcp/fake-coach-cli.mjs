// A stand-in for dist/cli.js in the coach-mcp tests: it behaves like the Garmin
// commands without contacting Garmin. FAKE_DELAY_MS sets how long each "day" takes.
const [cmd, ...rest] = process.argv.slice(2);
const flags = Object.fromEntries(
  rest.filter((a) => a.startsWith("--")).map((a) => {
    const [k, v] = a.slice(2).split("=");
    return [k, v ?? true];
  })
);
const delay = Number(process.env.FAKE_DELAY_MS || 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const progress = (m) => {
  if (process.env.COACH_PROGRESS === "1") process.stderr.write(`progress: ${m}\n`);
};

if (cmd === "garmin-backfill") {
  if (flags.from === "fail") {
    process.stderr.write("progress: day 1/1\ngarmin-backfill: Garmin said 401\n");
    process.exit(1);
  }
  const days = 3;
  for (let i = 1; i <= days; i++) {
    progress(`wellness day ${i}/${days}`);
    await sleep(delay);
  }
  console.log(JSON.stringify({ activities: 2, wellnessDays: days, from: flags.from }, null, 2));
} else if (cmd === "wellness") {
  console.log(JSON.stringify({ water: 1200 }));
} else {
  process.stderr.write(`unknown command ${cmd}\n`);
  process.exit(1);
}
