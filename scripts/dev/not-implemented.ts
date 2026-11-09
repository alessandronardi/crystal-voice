// Placeholder for commands documented in AGENTS.md §6 whose implementation
// belongs to a later issue. It exits non-zero on purpose: a command that does
// nothing must never look like a passing check (AGENTS.md R14).
const [command = 'unknown', issue = 'unknown'] = process.argv.slice(2);
console.error(`"pnpm ${command}" non ancora implementato: arriva con la issue ${issue}.`);
process.exit(1);
