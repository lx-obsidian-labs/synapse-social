/* Small deterministic routing and run limits. No model call is needed to choose
 * between a text response and a browser task. Shared by UI and regression tests. */
;(function (root) {
  function artworkGoal(objective) {
    const text = String(objective || '');
    if (/\b(research|review|critique|compare|explain|analy[sz]e)\b/i.test(text)) return false;
    if (/\b(brief|storyboard|plan|prompt|description|copy|caption)\b/i.test(text) && !/\b(render|download)\b/i.test(text)) return false;
    return /\b(create|generate|design|render|download|make)\b[\s\S]*\b(image|images|logo|logos|poster|posters|flyer|flyers|artwork|graphic|graphics|png)\b/i.test(text);
  }
  function route(objective, mode = 'auto') {
    if (mode === 'browser') return { kind: 'browser', reason: 'Browser mode selected' };
    if (mode === 'reply') return { kind: 'reply', reason: 'Reply mode selected' };
    const text = String(objective || '').trim();
    const browser = /\b(research|browse|navigate|visit|click|scroll|download|upload|extract)\b/i.test(text) ||
      /https?:\/\//i.test(text) || /\b(this|current|active)\s+(web\s*)?(page|tab|site)\b/i.test(text) ||
      /\b(open|check|read|send|reply|archive|delete|manage)\b[\s\S]*\b(gmail|inbox|email|mail|dashboard|website|youtube|browser)\b/i.test(text) ||
      /\b(on|in|using)\s+(chatgpt|canva|facebook|linkedin|youtube|instagram)\b/i.test(text) || artworkGoal(text);
    return browser ? { kind: 'browser', reason: 'Task needs live browser evidence or interaction' }
      : { kind: 'reply', reason: 'A direct text response is sufficient' };
  }
  function delegatesToChat(objective) {
    const text = String(objective || '');
    if (/\b(read|summari[sz]e|extract|inspect)\b/i.test(text) && !/\b(send|type|ask)\b/i.test(text)) return false;
    return artworkGoal(text) || /\b(ask|tell|send|type|message)\b/i.test(text);
  }
  class RunLimitError extends Error {
    constructor(message, code = 'RUN_LIMIT') { super(message); this.code = code; }
  }
  class RunBudget {
    constructor({ maxTurns = 60, maxErrors = 3, maxVerification = 3, maxMs = 600000, now = Date.now } = {}) {
      this.now = now; this.deadline = now() + maxMs;
      this.maxTurns = maxTurns; this.maxErrors = maxErrors; this.maxVerification = maxVerification;
      this.turns = 0; this.errors = 0; this.verifications = 0; this.stopped = false;
    }
    check() {
      if (this.stopped) throw new RunLimitError('Stopped by user.', 'RUN_STOPPED');
      if (this.now() >= this.deadline) throw new RunLimitError('Task reached its time limit. No further actions were started.');
    }
    beginTurn() {
      this.check();
      if (this.turns >= this.maxTurns) throw new RunLimitError('Task reached its planning-turn limit without verified completion.');
      return ++this.turns;
    }
    failTurn() {
      if (++this.errors >= this.maxErrors) throw new RunLimitError('Repeated orchestration errors. Stopped after ' + this.errors + ' failed turns.');
    }
    progress() { this.errors = 0; }
    rejectCompletion() {
      if (++this.verifications >= this.maxVerification) throw new RunLimitError('Completion could not be verified after ' + this.verifications + ' attempts.');
    }
    stop() { this.stopped = true; }
  }
  const api = { route, artworkGoal, delegatesToChat, RunBudget, RunLimitError };
  root.SynapseOrchestrator = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
