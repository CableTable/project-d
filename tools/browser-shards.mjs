// Timing keys are in suite order. Cuts follow elapsed seconds, never step count.
export function shardSelector(timings, index, count) {
  const entries = Object.entries(timings).filter(([name]) => name !== 'no console errors');
  if (entries.length < count) throw new Error('Not enough timed steps for the requested shards');
  const sums = [0];
  for (const [, seconds] of entries) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid browser step timing');
    sums.push(sums.at(-1) + seconds);
  }
  const cuts = [0];
  for (let shard = 1; shard < count; shard++) {
    const target = sums.at(-1) * shard / count;
    let cut = cuts.at(-1) + 1;
    for (let i = cut + 1; i <= entries.length - (count - shard); i++) {
      if (Math.abs(sums[i] - target) < Math.abs(sums[cut] - target)) cut = i;
    }
    cuts.push(cut);
  }
  cuts.push(entries.length);
  const assignments = new Map();
  for (let shard = 1; shard <= count; shard++) {
    for (let i = cuts[shard - 1]; i < cuts[shard]; i++) assignments.set(entries[i][0], shard);
  }
  let current = 1;
  return (name) => {
    if (name === 'no console errors') return true;
    // New steps inherit their predecessor's shard, including before timings are refreshed.
    current = assignments.get(name) ?? current;
    return current === index;
  };
}

export function browserArgs(args, env = {}) {
  const positional = [];
  let shots = env.SHOTS_DIR || 'shots';
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--shots') {
      shots = args[++i];
      if (!shots || shots.startsWith('--') || shots.startsWith('SHARD=')) throw new Error('--shots requires a directory');
    } else if (arg !== '--update-timings' && !arg.startsWith('SHARD=') && !arg.startsWith('--shard=')) positional.push(arg);
  }
  const only = env.ONLY || positional[1];
  const value = env.SHARD || args.find((arg) => /^(SHARD|--shard)=/.test(arg))?.split('=')[1];
  let shard;
  if (value && !only) {
    const match = /^(\d+)\/(\d+)$/.exec(value);
    if (!match || +match[1] < 1 || +match[1] > +match[2]) throw new Error('SHARD must be i/N, with 1 <= i <= N');
    shard = { index: +match[1], count: +match[2] };
  }
  const updateTimings = args.includes('--update-timings');
  if (updateTimings && (only || shard)) throw new Error('--update-timings requires a full, unfiltered run');
  const port = Number(env.TEST_PORT || positional[0] || 5181);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid browser test port');
  return { port, only, shard, updateTimings, shots };
}

// Prerequisites are earlier steps: keep their state changes in the suite's file order.
export function expandNeeds(steps, only) {
  const byName = new Map(steps.map((step, index) => [step.name, index]));
  if (byName.size !== steps.length) throw new Error('Duplicate browser step name');
  const selected = new Set(), filter = new RegExp(only);
  const include = (index) => {
    if (selected.has(index)) return;
    selected.add(index);
    for (const name of steps[index].needs || []) {
      const dependency = byName.get(name);
      if (dependency === undefined) throw new Error(`Unknown browser step need: ${name}`);
      if (dependency >= index) throw new Error(`Browser step need must precede ${steps[index].name}: ${name}`);
      include(dependency);
    }
  };
  steps.forEach((step, index) => { if (filter.test(step.name)) include(index); });
  return steps.filter((_, index) => selected.has(index));
}
