// Run with: node supabase/tests/run-grocery-lots.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
require('@next/env').loadEnvConfig(process.cwd());
const url = readFileSync('supabase/.temp/pooler-url', 'utf8').trim();
const ref = readFileSync('supabase/.temp/project-ref', 'utf8').trim();
if (ref !== 'mcdpiuiayfljzvnhtqto' || !url.includes(`postgres.${ref}@`)) throw Error('Refusing to test outside dev');
const env = { ...process.env, PGPASSWORD: process.env.SUPABASE_DB_PASSWORD };
function sql(source) {
  return new Promise((resolve, reject) => {
    const child = spawn('psql', [url, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'], { env });
    let output = '', error = '';
    child.stdout.on('data', (data) => { output += data; });
    child.stderr.on('data', (data) => { error += data; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(output.trim()) : reject(Error(error)));
    child.stdin.end(source);
  });
}
await sql(`begin;\n${readFileSync('supabase/tests/grocery_lots.sql', 'utf8')}\nrollback;`);
console.log('Batch SQL assertions and RLS passed (rolled back).');

// A committed, uniquely identified fixture lets two real connections race. Cleanup is scoped
// to this generated workspace and runs even if an assertion fails.
const workspace = randomUUID(), item = randomUUID();
try {
  await sql(`begin;
    insert into public.workspaces(id,name,kind) values('${workspace}','E2E grocery concurrency','household');
    insert into public.grocery_items(id,workspace_id,name) values('${item}','${workspace}','Milk');
    select public.grocery_mark_bought('${item}', '2026-09-12', false, 2);
    commit;`);
  async function race(first, second) {
    const child = spawn('psql', [url, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'], { env });
    let errors = '';
    child.stderr.on('data', (data) => { errors += data; });
    const done = new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code) => code === 0 ? resolve() : reject(Error(errors)));
    });
    const locked = new Promise((resolve) => {
      let output = '';
      child.stdout.on('data', (data) => { output += data; if (output.includes('LOCKED')) resolve(); });
    });
    child.stdin.write(`begin; select id from public.grocery_items where id = '${item}' for update;\n\\echo LOCKED\n`);
    await Promise.race([locked, done.then(() => { throw Error('Connection ended before lock'); })]);
    const concurrent = sql(`begin; ${second}; commit;`);
    child.stdin.end(`select pg_sleep(1); ${first}; commit;`);
    await Promise.all([done, concurrent]);
  }
  await race(`select public.grocery_adjust_quantity('${item}', -1)`, `select public.grocery_adjust_quantity('${item}', -1)`);
  await sql(`do $$ begin
    assert (select not in_stock and needed from public.grocery_items where id = '${item}');
    assert not exists(select 1 from public.grocery_lots where item_id = '${item}');
  end $$;`);
  await sql(`select public.grocery_mark_bought('${item}', '2026-09-12', false, 2);`);
  await race(`select public.grocery_finish('${item}', false)`, `select public.grocery_mark_bought('${item}', '2026-09-20', false, 3)`);
  await sql(`do $$ begin
    assert (select in_stock and not needed from public.grocery_items where id = '${item}');
    assert (select count(*) = 1 and sum(quantity) = 3 from public.grocery_lots where item_id = '${item}');
  end $$;`);
  console.log('Concurrent decrements and finish/purchase passed.');
} finally {
  await sql(`delete from public.workspaces where id = '${workspace}';`);
}
