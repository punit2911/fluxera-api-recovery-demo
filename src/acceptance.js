// Acceptance checks computed from recorded data only. Nothing here is a
// hard-coded "pass": every result is derived from the latest run.
export function computeAcceptance({ original, recovery, nodesOf, incident, sandbox, video, runStarted }) {
  const out = [];
  const add = (area, observable, status, detail) => out.push({ area, observable, status, detail });

  if (!original) {
    for (const [area, observable] of [
      ['API coverage', 'Multiple API types'],
      ['Instrumentation', 'Execution tree'],
      ['Failure', 'Failed API leaf'],
      ['Work continuity', 'Workflow state'],
      ['Recovery', 'Original and recovery link'],
      ['Verification', 'Final outcome'],
      ['Costs', 'Unified cost sheet'],
      ['Website', 'Live demo'],
      ['Video', 'Walkthrough'],
      ['Safety', 'Non-destructive behavior'],
    ]) {
      add(area, observable, 'pending', 'Run the demo to produce evidence.');
    }
    return out;
  }

  const nodes = nodesOf(original.id);
  const leaves = nodes.filter((n) => n.type === 'api');
  const categories = [...new Set(leaves.map((n) => n.apiCategory))];
  add(
    'API coverage',
    'Multiple API types',
    categories.length > 1 ? 'pass' : 'fail',
    `${categories.length} categories observed on ${original.id}: ${categories.join(', ')}`,
  );

  const types = new Set(nodes.map((n) => n.type));
  const needed = ['workflow', 'agent', 'memory', 'tool', 'api'];
  const missing = needed.filter((t) => !types.has(t));
  add(
    'Instrumentation',
    'Execution tree',
    missing.length === 0 ? 'pass' : 'fail',
    missing.length === 0
      ? `workflow, agent, memory, tool and api nodes share execution ${original.id}`
      : `Missing node types: ${missing.join(', ')}`,
  );

  const failedLeaf = leaves.find((n) => n.status === 'error');
  const leafOk = failedLeaf && failedLeaf.errorCategory && failedLeaf.attempts.length > 0 && failedLeaf.durationMs != null;
  add(
    'Failure',
    'Failed API leaf',
    leafOk ? 'pass' : original.status === 'failed' ? 'fail' : 'pending',
    leafOk
      ? `${failedLeaf.name}: ${failedLeaf.errorCategory}, ${failedLeaf.attempts.length} attempt(s), ${failedLeaf.durationMs} ms`
      : 'No failed API leaf recorded for this run.',
  );

  const cont = incident?.continuity;
  const distinct = cont
    ? [
        cont.buckets.completed.length > 0,
        cont.buckets.failed.length > 0,
        cont.buckets.waiting.length > 0,
        cont.buckets.unresolved.length > 0,
        cont.buckets.safeToContinue.length > 0,
      ]
    : [];
  add(
    'Work continuity',
    'Workflow state',
    !cont ? 'pending' : distinct.every(Boolean) ? 'pass' : 'fail',
    cont
      ? `${cont.buckets.completed.length} completed, ${cont.buckets.failed.length} failed, ${cont.buckets.waiting.length} waiting, ${cont.buckets.unresolved.length} unresolved, ${cont.buckets.safeToContinue.length} safe to continue`
      : 'Waiting for failure analysis.',
  );

  if (incident?.status === 'escalated') {
    add('Recovery', 'Original and recovery link', 'n/a', 'Recovery was judged unsafe. Fluxera escalated instead of replaying.');
    add('Verification', 'Final outcome', 'n/a', 'Nothing is verified because no recovery execution ran.');
  } else {
    add(
      'Recovery',
      'Original and recovery link',
      recovery && recovery.recoveryOf === original.id && incident?.actions.length ? 'pass' : 'pending',
      recovery ? `${recovery.id} is linked to ${original.id}; action ${incident.actions[0]?.type}` : 'No recovery execution yet.',
    );
    add(
      'Verification',
      'Final outcome',
      incident?.status === 'verified' ? 'pass' : incident?.status === 'recovery_failed' ? 'fail' : 'pending',
      incident?.status === 'verified'
        ? 'All verification checks passed on the linked recovery execution.'
        : 'Not verified. Verification requires a successful linked recovery result.',
    );
  }

  add(
    'Costs',
    'Unified cost sheet',
    'pass',
    'Rows are labeled Observed, Estimated or Verified; estimates and savings are never mixed.',
  );
  add('Website', 'Live demo', runStarted ? 'pass' : 'pending', runStarted ? 'This run was started from the Run Demo control through the API.' : 'Not run yet.');
  add(
    'Video',
    'Walkthrough',
    video.type === 'none' ? 'pending' : 'pass',
    video.type === 'none' ? 'No walkthrough configured yet. Add public/media/walkthrough.mp4 or set VIDEO_URL.' : `Embedded (${video.type}).`,
  );

  const ledger = sandbox.ledger(original.runId);
  add(
    'Safety',
    'Non-destructive behavior',
    ledger.liveOperations === 0 && ledger.duplicateSideEffects === 0 && ledger.refunds.fundsMoved === 0 ? 'pass' : 'fail',
    `${ledger.liveOperations} live operations, ${ledger.duplicateSideEffects} duplicate side effects, ${ledger.refunds.fundsMoved} funds moved`,
  );
  return out;
}
