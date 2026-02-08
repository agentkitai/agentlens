/**
 * agentlens lessons — Manage agent lessons (CRUD + search)
 */
import { parseArgs } from 'node:util';
import { createClientFromConfig } from '../lib/client.js';
import { printTable, printJson, truncate, formatTimestamp } from '../lib/output.js';

const HELP = `Usage: agentlens lessons <subcommand> [options]

Manage agent lessons — distilled insights and knowledge.

Subcommands:
  list                  List lessons
  create                Create a new lesson
  get <id>              Get a lesson by ID
  update <id>           Update a lesson
  delete <id>           Delete (archive) a lesson
  search <query>        Search lessons by text

Options (common):
  --url <url>           Server URL (overrides config)
  -j, --json            Output raw JSON
  -h, --help            Show help

Options (list):
  --category <cat>      Filter by category
  --importance <level>  Filter by importance: low|normal|high|critical
  --agent <id>          Filter by agent ID
  --limit <n>           Max results (default: 20)
  --offset <n>          Pagination offset

Options (create):
  --title <title>       Lesson title (required)
  --content <text>      Lesson content (required)
  --category <cat>      Category (default: general)
  --importance <level>  Importance: low|normal|high|critical (default: normal)
  --agent <id>          Agent ID to scope the lesson to

Options (update):
  --title <title>       New title
  --content <text>      New content
  --category <cat>      New category
  --importance <level>  New importance level

Examples:
  agentlens lessons list
  agentlens lessons list --category deployment --importance high
  agentlens lessons create --title "Always run tests" --content "Run test suite before deploying" --category deployment
  agentlens lessons get abc123
  agentlens lessons update abc123 --content "updated content"
  agentlens lessons delete abc123
  agentlens lessons search "deployment best practices"`;

export async function runLessonsCommand(argv: string[]): Promise<void> {
  const subcommand = argv[0];
  const rest = argv.slice(1);

  switch (subcommand) {
    case 'list':
      await runLessonsList(rest);
      break;
    case 'create':
      await runLessonsCreate(rest);
      break;
    case 'get':
      await runLessonsGet(rest);
      break;
    case 'update':
      await runLessonsUpdate(rest);
      break;
    case 'delete':
      await runLessonsDelete(rest);
      break;
    case 'search':
      await runLessonsSearch(rest);
      break;
    case '--help':
    case '-h':
    case undefined:
      console.log(HELP);
      break;
    default:
      console.error(`Unknown lessons subcommand: ${subcommand}`);
      console.log(HELP);
      process.exit(1);
  }
}

function parseLessonsArgs(argv: string[]) {
  return parseArgs({
    args: argv,
    options: {
      title: { type: 'string' },
      content: { type: 'string' },
      category: { type: 'string' },
      importance: { type: 'string' },
      agent: { type: 'string', short: 'a' },
      limit: { type: 'string', short: 'l' },
      offset: { type: 'string' },
      url: { type: 'string' },
      json: { type: 'boolean', short: 'j', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
  });
}

/**
 * agentlens lessons list
 */
async function runLessonsList(argv: string[]): Promise<void> {
  const { values } = parseLessonsArgs(argv);

  if (values.help) {
    console.log(`Usage: agentlens lessons list [options]

List lessons with optional filters.

Options:
  --category <cat>      Filter by category
  --importance <level>  Filter by importance: low|normal|high|critical
  --agent <id>          Filter by agent ID
  --limit <n>           Max results (default: 20)
  --offset <n>          Pagination offset
  --url <url>           Server URL
  -j, --json            Output raw JSON
  -h, --help            Show help`);
    return;
  }

  const client = createClientFromConfig(values.url);

  const result = await client.getLessons({
    category: values.category ?? undefined,
    importance: (values.importance as 'low' | 'normal' | 'high' | 'critical') ?? undefined,
    agentId: values.agent ?? undefined,
    limit: values.limit ? parseInt(values.limit, 10) : 20,
    offset: values.offset ? parseInt(values.offset, 10) : undefined,
  });

  if (values.json) {
    printJson(result);
    return;
  }

  if (result.lessons.length === 0) {
    console.log('No lessons found.');
    return;
  }

  const headers = ['ID', 'Category', 'Importance', 'Title', 'Created'];
  const rows = result.lessons.map((l) => [
    truncate(l.id, 16),
    l.category,
    l.importance,
    truncate(l.title, 40),
    formatTimestamp(l.createdAt),
  ]);

  printTable(headers, rows);
  console.log(`\n${result.lessons.length} of ${result.total} lesson(s).`);
}

/**
 * agentlens lessons create
 */
async function runLessonsCreate(argv: string[]): Promise<void> {
  const { values } = parseLessonsArgs(argv);

  if (values.help) {
    console.log(`Usage: agentlens lessons create [options]

Create a new lesson.

Options:
  --title <title>       Lesson title (required)
  --content <text>      Lesson content (required)
  --category <cat>      Category (default: general)
  --importance <level>  Importance: low|normal|high|critical (default: normal)
  --agent <id>          Agent ID
  --url <url>           Server URL
  -j, --json            Output raw JSON
  -h, --help            Show help`);
    return;
  }

  if (!values.title) {
    console.error('Error: --title is required.');
    process.exit(1);
  }
  if (!values.content) {
    console.error('Error: --content is required.');
    process.exit(1);
  }

  const client = createClientFromConfig(values.url);

  const lesson = await client.createLesson({
    title: values.title,
    content: values.content,
    category: values.category ?? undefined,
    importance: (values.importance as 'low' | 'normal' | 'high' | 'critical') ?? undefined,
    agentId: values.agent ?? undefined,
  });

  if (values.json) {
    printJson(lesson);
    return;
  }

  console.log(`\nLesson created: ${lesson.id}`);
  console.log(`  Title:      ${lesson.title}`);
  console.log(`  Category:   ${lesson.category}`);
  console.log(`  Importance: ${lesson.importance}`);
  console.log('');
}

/**
 * agentlens lessons get <id>
 */
async function runLessonsGet(argv: string[]): Promise<void> {
  const { values, positionals } = parseLessonsArgs(argv);

  if (values.help) {
    console.log(`Usage: agentlens lessons get <id> [options]

Get a lesson by ID with full details.

Options:
  --url <url>           Server URL
  -j, --json            Output raw JSON
  -h, --help            Show help`);
    return;
  }

  const id = positionals[0];
  if (!id) {
    console.error('Error: Lesson ID is required.');
    process.exit(1);
  }

  const client = createClientFromConfig(values.url);
  const lesson = await client.getLesson(id);

  if (values.json) {
    printJson(lesson);
    return;
  }

  console.log('');
  console.log(`Lesson: ${lesson.id}`);
  console.log(`  Title:        ${lesson.title}`);
  console.log(`  Category:     ${lesson.category}`);
  console.log(`  Importance:   ${lesson.importance}`);
  console.log(`  Created:      ${formatTimestamp(lesson.createdAt)}`);
  console.log(`  Updated:      ${formatTimestamp(lesson.updatedAt)}`);
  console.log(`  Access Count: ${lesson.accessCount}`);
  if (lesson.agentId) {
    console.log(`  Agent:        ${lesson.agentId}`);
  }
  if (lesson.sourceSessionId) {
    console.log(`  Source Session: ${lesson.sourceSessionId}`);
  }
  console.log('');
  console.log('Content:');
  console.log(`  ${lesson.content}`);
  console.log('');
}

/**
 * agentlens lessons update <id>
 */
async function runLessonsUpdate(argv: string[]): Promise<void> {
  const { values, positionals } = parseLessonsArgs(argv);

  if (values.help) {
    console.log(`Usage: agentlens lessons update <id> [options]

Update an existing lesson.

Options:
  --title <title>       New title
  --content <text>      New content
  --category <cat>      New category
  --importance <level>  New importance level
  --url <url>           Server URL
  -j, --json            Output raw JSON
  -h, --help            Show help`);
    return;
  }

  const id = positionals[0];
  if (!id) {
    console.error('Error: Lesson ID is required.');
    process.exit(1);
  }

  const updates: Record<string, string> = {};
  if (values.title) updates.title = values.title;
  if (values.content) updates.content = values.content;
  if (values.category) updates.category = values.category;
  if (values.importance) updates.importance = values.importance;

  if (Object.keys(updates).length === 0) {
    console.error('Error: At least one field to update is required (--title, --content, --category, --importance).');
    process.exit(1);
  }

  const client = createClientFromConfig(values.url);
  const lesson = await client.updateLesson(id, updates);

  if (values.json) {
    printJson(lesson);
    return;
  }

  console.log(`\nLesson updated: ${lesson.id}`);
  console.log(`  Title:      ${lesson.title}`);
  console.log(`  Category:   ${lesson.category}`);
  console.log(`  Importance: ${lesson.importance}`);
  console.log('');
}

/**
 * agentlens lessons delete <id>
 */
async function runLessonsDelete(argv: string[]): Promise<void> {
  const { values, positionals } = parseLessonsArgs(argv);

  if (values.help) {
    console.log(`Usage: agentlens lessons delete <id> [options]

Delete (archive) a lesson.

Options:
  --url <url>           Server URL
  -j, --json            Output raw JSON
  -h, --help            Show help`);
    return;
  }

  const id = positionals[0];
  if (!id) {
    console.error('Error: Lesson ID is required.');
    process.exit(1);
  }

  const client = createClientFromConfig(values.url);
  const result = await client.deleteLesson(id);

  if (values.json) {
    printJson(result);
    return;
  }

  console.log(`Lesson ${id} archived successfully.`);
}

/**
 * agentlens lessons search <query>
 */
async function runLessonsSearch(argv: string[]): Promise<void> {
  const { values, positionals } = parseLessonsArgs(argv);

  if (values.help) {
    console.log(`Usage: agentlens lessons search <query> [options]

Search lessons by text.

Options:
  --category <cat>      Filter by category
  --agent <id>          Filter by agent ID
  --limit <n>           Max results (default: 20)
  --url <url>           Server URL
  -j, --json            Output raw JSON
  -h, --help            Show help`);
    return;
  }

  const query = positionals[0];
  if (!query) {
    console.error('Error: Search query is required.');
    process.exit(1);
  }

  const client = createClientFromConfig(values.url);

  const result = await client.getLessons({
    search: query,
    category: values.category ?? undefined,
    agentId: values.agent ?? undefined,
    limit: values.limit ? parseInt(values.limit, 10) : 20,
  });

  if (values.json) {
    printJson(result);
    return;
  }

  if (result.lessons.length === 0) {
    console.log(`No lessons found matching "${query}".`);
    return;
  }

  const headers = ['ID', 'Category', 'Importance', 'Title', 'Preview'];
  const rows = result.lessons.map((l) => [
    truncate(l.id, 16),
    l.category,
    l.importance,
    truncate(l.title, 30),
    truncate(l.content.replace(/\n/g, ' '), 40),
  ]);

  printTable(headers, rows);
  console.log(`\n${result.lessons.length} of ${result.total} lesson(s) matching "${query}".`);
}
