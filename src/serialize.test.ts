import { describe, expect, it } from 'vitest';
import { serialize } from './serialize';

/** await をまたいで「入った/出た」を記録する処理 (contextMenus の removeAll→create 相当) */
function makeTask(log: string[], fail = false) {
  let n = 0;
  return async () => {
    const id = ++n;
    log.push(`enter${id}`);
    await Promise.resolve(); // ここで他方へ制御が移りうる
    await Promise.resolve();
    log.push(`exit${id}`);
    if (fail) throw new Error('boom');
  };
}

describe('serialize', () => {
  it('直列化しないと処理が入れ子になる (これが直したかったバグ)', async () => {
    const log: string[] = [];
    const task = makeTask(log);
    await Promise.all([task(), task(), task()]);
    // enter が 3 つ並んでから exit が来る = removeAll が 3 回走ってから create が 3 回走る形
    expect(log).toEqual(['enter1', 'enter2', 'enter3', 'exit1', 'exit2', 'exit3']);
  });

  it('直列化すると 1 つずつ完結する', async () => {
    const log: string[] = [];
    const run = serialize(makeTask(log));
    await Promise.all([run(), run(), run()]);
    expect(log).toEqual(['enter1', 'exit1', 'enter2', 'exit2', 'enter3', 'exit3']);
  });

  it('失敗しても列は止まらない (1 回の失敗で以後が詰まらない)', async () => {
    const log: string[] = [];
    let calls = 0;
    const run = serialize(async () => {
      calls += 1;
      log.push(`run${calls}`);
      if (calls === 1) throw new Error('boom');
    });
    await Promise.allSettled([run(), run(), run()]);
    expect(log).toEqual(['run1', 'run2', 'run3']);
  });

  it('返る Promise は自分の番の完了を待つ', async () => {
    const order: string[] = [];
    const run = serialize(async () => {
      await Promise.resolve();
      order.push('task');
    });
    await run();
    order.push('after');
    expect(order).toEqual(['task', 'after']);
  });
});
