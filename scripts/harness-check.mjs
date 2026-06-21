import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

const requiredFiles = [
  "AGENTS.md",
  ".github/copilot-instructions.md",
  ".agents/skills/reddit-hackathon-builder/SKILL.md",
  ".agents/skills/playwright-game-verifier/SKILL.md",
  "harness/01-hackathon-brief.md",
  "harness/02-devvit-platform.md",
  "harness/03-product-strategy.md",
  "harness/04-build-workflow.md",
  "harness/05-quality-gates.md",
  "harness/06-resources.md",
  "harness/07-submission.md",
  "harness/08-skills-and-tools.md",
  "templates/GAME_SPEC.md",
  "templates/DECISIONS.md",
  "templates/SUBMISSION.md",
  "notes/DECISIONS.md",
];

const missing = requiredFiles.filter((file) => !existsSync(join(root, file)));

const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
const expectedPhrases = [
  "Reddit Games With A Hook Hackathon Harness",
  "Devvit Web",
  "July 15, 2026",
  "BRIEF -> CONCEPT -> SCAFFOLD",
  "reddit-hackathon-builder",
  "playwright-game-verifier",
];

const missingPhrases = expectedPhrases.filter((phrase) => !agents.includes(phrase));

const errors = [];
if (missing.length) {
  errors.push(`Missing files:\n${missing.map((file) => `- ${file}`).join("\n")}`);
}

const skillFiles = [
  ".agents/skills/reddit-hackathon-builder/SKILL.md",
  ".agents/skills/playwright-game-verifier/SKILL.md",
];

for (const file of skillFiles) {
  const text = readFileSync(join(root, file), "utf8");
  if (!text.startsWith("---\n")) {
    errors.push(`${file} is missing YAML frontmatter.`);
    continue;
  }

  const end = text.indexOf("\n---\n", 4);
  if (end === -1) {
    errors.push(`${file} has malformed YAML frontmatter delimiter.`);
    continue;
  }

  const yaml = text.slice(4, end);
  for (const key of ["name:", "description:"]) {
    if (!yaml.includes(key)) {
      errors.push(`${file} YAML frontmatter is missing ${key}`);
    }
  }
}

if (missingPhrases.length) {
  errors.push(`AGENTS.md missing expected phrases:\n${missingPhrases.map((phrase) => `- ${phrase}`).join("\n")}`);
}

if (agents.includes("Burp") || agents.includes("WAF")) {
  errors.push("AGENTS.md appears to contain unrelated security harness instructions.");
}

const appPackagePath = join(root, "package.json");
if (existsSync(appPackagePath)) {
  const pkg = JSON.parse(readFileSync(appPackagePath, "utf8"));
  if (pkg.dependencies?.["@devvit/client"] || pkg.dependencies?.["@devvit/server"]) {
    const scripts = pkg.scripts ?? {};
    for (const scriptName of ["dev", "build", "launch"]) {
      if (!scripts[scriptName]) {
        errors.push(`Generated Devvit app package is missing npm script: ${scriptName}`);
      }
    }
  }
}

if (errors.length) {
  console.error(errors.join("\n\n"));
  process.exit(1);
}

console.log("reddit hackathon harness check passed");
