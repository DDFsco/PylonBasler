// Constant-size online accounting. Synthetic token matching is kept separate from hardware mapping.
export class OnlineQC {
  constructor(ids, onIssue = () => {}) {
    this.ids = ids;
    this.onIssue = onIssue;
    this.issueCount = 0;
    this.sample = [];
    this.events = 0;
    this.prev = new Map();
  }
  issue(issue) {
    this.issueCount++;
    if (this.sample.length < 100) this.sample.push(issue);
    this.onIssue(issue);
  }
  inspect(pulse, ttl, frames) {
    this.events++;
    for (const id of this.ids) {
      const ff = frames.filter((f) => f.id === id),
        tt = ttl.filter((t) => t.eventId === pulse.id);
      let status = 'matched_simulation',
        flag = 'synthetic_causal_token_only';
      if (ff.length > 1 || tt.length > 1) {
        status = 'ambiguous';
        flag = ff.length > 1 ? 'duplicate_frame' : 'duplicate_ttl';
      } else if (ff.some((f) => f.eventId !== pulse.id)) {
        status = 'ambiguous';
        flag = 'no_alignment_evidence';
      } else if (!ff.length && !tt.length) {
        status = 'ambiguous';
        flag = 'both_missing';
      } else if (!ff.length) {
        status = 'missing_frame';
        flag = 'no_frame';
      } else if (!tt.length) {
        status = 'missing_ttl';
        flag = 'no_ttl';
      }
      if (status !== 'matched_simulation')
        this.issue({ camera: id, event: pulse.id, status, flag });
      for (const f of ff) {
        const old = this.prev.get(id);
        if (old && f.block <= old.block)
          this.issue({ camera: id, event: pulse.id, status: 'block_id_reset_or_duplicate' });
        if (old && f.ticks <= old.ticks)
          this.issue({ camera: id, event: pulse.id, status: 'clock_nonmonotonic' });
        this.prev.set(id, { block: f.block, ticks: f.ticks });
      }
    }
  }
  report() {
    return {
      events: this.events,
      issue_count: this.issueCount,
      issue_sample: this.sample,
      alignment_basis: 'simulation_causal_tokens_only',
      hardware_acceptance: false,
    };
  }
}
