declare function acquireVsCodeApi(): {
  postMessage(message: any): void;
};

const vscode = acquireVsCodeApi();

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

type SessionSnapshot = {
  sessionId: string;
  cwd: string;
  pid: number;
  state: string;
  alive: boolean;
  backend?: string;
  lastOutputPreview?: string;
  waitingInput?: boolean;
  pendingOutputChars?: number;
};

const els = {
  sessions: $('sessions') as HTMLDivElement,
  sessionTitle: $('session-title') as HTMLHeadingElement,
  sessionSubtitle: $('session-subtitle') as HTMLParagraphElement,
  command: $('command') as HTMLInputElement,
  send: $('send') as HTMLButtonElement,
  stop: $('stop') as HTMLButtonElement,
  output: $('output') as HTMLPreElement,
  status: $('status') as HTMLSpanElement,
  pid: $('pid') as HTMLSpanElement,
  state: $('state') as HTMLSpanElement,
  cwdMeta: $('cwd-meta') as HTMLSpanElement,
  sessionMeta: $('session-meta') as HTMLSpanElement,
  backendMeta: $('backend-meta') as HTMLSpanElement,
};

let activeSessionId = '';
let preferredSessionId = '';
let autoScroll = true;
let sessionsCache: SessionSnapshot[] = [];
let outputBySession = new Map<string, string>();
let lastChunkBySession = new Map<string, string>();
let listRefreshTimers: number[] = [];

const MAX_OUTPUT_CHARS = 50000; // Limite de 50k chars para performance da UI

function post(type: string, payload?: any) {
  vscode.postMessage({ type, payload });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function setRenderedOutput(text: string) {
  els.output.innerHTML = escapeHtml(text || '');
  if (autoScroll) {
    els.output.scrollTop = els.output.scrollHeight;
  }
}

function renderActiveOutput() {
  setRenderedOutput(outputBySession.get(activeSessionId) || '');
}

function scheduleRefreshSessions(selectedSessionId?: string, delayMs = 0) {
  const timer = window.setTimeout(() => {
    listRefreshTimers = listRefreshTimers.filter(current => current !== timer);
    refreshSessions(selectedSessionId);
  }, delayMs);
  listRefreshTimers.push(timer);
}

function setSessionMeta(session?: SessionSnapshot) {
  const alive = !!session?.alive;
  els.status.innerHTML = `<span class="dot ${alive ? 'live' : 'dead'}"></span>`;
  els.pid.textContent = `PID: ${session?.pid ?? '-'}`;
  els.state.textContent = session?.state ?? '-';
  els.cwdMeta.textContent = session?.cwd ? `[${session.cwd}]` : '';
  els.sessionMeta.textContent = session?.sessionId || '';
  els.backendMeta.textContent = session?.backend || '';
  els.sessionTitle.textContent = session?.sessionId || 'Selecione um terminal';
  els.sessionSubtitle.textContent = '';
  els.command.disabled = !session?.sessionId || !alive;
  els.send.disabled = !session?.sessionId || !alive;
  els.stop.disabled = !session?.sessionId || !alive;
}

function setActiveSession(sessionId: string, preserveOutput = false) {
  activeSessionId = sessionId;
  preferredSessionId = sessionId;
  const session = sessionsCache.find(item => item.sessionId === sessionId);
  setSessionMeta(session);
  renderSessions();
  if (!preserveOutput && !outputBySession.has(sessionId)) {
    outputBySession.set(sessionId, '');
  }
  renderActiveOutput();
}

function resolveSessionSelection(explicitSessionId?: string) {
  if (explicitSessionId && sessionsCache.some(session => session.sessionId === explicitSessionId)) {
    return explicitSessionId;
  }

  if (preferredSessionId && sessionsCache.some(session => session.sessionId === preferredSessionId)) {
    return preferredSessionId;
  }

  if (activeSessionId && sessionsCache.some(session => session.sessionId === activeSessionId)) {
    return activeSessionId;
  }

  return sessionsCache[0]?.sessionId || '';
}

function appendOutput(chunk: string, sessionId = activeSessionId) {
  if (!sessionId || !chunk) return;

  // Deduplicação: se o chunk for idêntico ao anterior, ignora para evitar spam visual idêntico
  // (Pode ocorrer em processos que imprimem o mesmo erro em loop infinito muito rápido)
  if (lastChunkBySession.get(sessionId) === chunk) {
    return;
  }
  lastChunkBySession.set(sessionId, chunk);

  let currentOutput = outputBySession.get(sessionId) || '';
  let next = `${currentOutput}${chunk}`;

  // Limite de caracteres: mantém apenas os últimos MAX_OUTPUT_CHARS
  if (next.length > MAX_OUTPUT_CHARS) {
    next = next.slice(-MAX_OUTPUT_CHARS);
  }

  outputBySession.set(sessionId, next);
  if (sessionId === activeSessionId) {
    setRenderedOutput(next);
  }
}

function renderSessions() {
  els.sessions.innerHTML = '';

  if (!sessionsCache.length) {
    els.sessions.innerHTML = '<div class="empty">Nenhum terminal ativo no momento.</div>';
    return;
  }

  for (const session of sessionsCache) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `session-item ${session.sessionId === activeSessionId ? 'active' : ''}`;
    item.dataset.sessionId = session.sessionId;
    item.innerHTML = `
      <span class="dot ${session.alive ? 'live' : 'dead'}"></span>
      <span class="session-id">${escapeHtml(session.sessionId)}</span>
      ${session.waitingInput ? '<span class="badge waiting">!</span>' : ''}
    `;
    item.addEventListener('click', () => {
      setActiveSession(session.sessionId, true);
      post('ui/terminal/selectSession', { sessionId: session.sessionId });
      scheduleRefreshSessions(session.sessionId, 0);
    });
    els.sessions.appendChild(item);
  }
}

function refreshSessions(selectedSessionId?: string) {
  post('ui/terminal/listSessions', { sessionId: selectedSessionId || activeSessionId || undefined });
}

els.output.addEventListener('scroll', () => {
  const distanceFromBottom = els.output.scrollHeight - els.output.scrollTop - els.output.clientHeight;
  autoScroll = distanceFromBottom < 40;
});

els.stop.addEventListener('click', () => {
  if (!activeSessionId) return;
  const sessionId = activeSessionId;
  els.stop.disabled = true;
  post('ui/terminal/stop', { sessionId, signal: 'SIGKILL', force: true });
  scheduleRefreshSessions(sessionId, 0);
  scheduleRefreshSessions(sessionId, 80);
  scheduleRefreshSessions(sessionId, 300);
  scheduleRefreshSessions(sessionId, 800);
});

els.send.addEventListener('click', () => {
  const input = els.command.value;
  if (!activeSessionId || !input) return;
  post('ui/terminal/send', { sessionId: activeSessionId, input });
  els.command.value = '';
});

els.command.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    els.send.click();
  }
});

window.addEventListener('message', (event) => {
  const { type, payload } = event.data || {};

  switch (type) {
    case 'terminal/bootstrap': {
      if (payload?.sessionId) {
        preferredSessionId = payload.sessionId;
      }
      if (payload?.snapshot) {
        const index = sessionsCache.findIndex(session => session.sessionId === payload.snapshot.sessionId);
        if (index >= 0) {
          sessionsCache[index] = { ...sessionsCache[index], ...payload.snapshot };
        } else {
          sessionsCache.unshift(payload.snapshot);
        }
      }
      if (payload?.initialOutput && payload?.sessionId) {
        let initial = payload.initialOutput;
        if (initial.length > MAX_OUTPUT_CHARS) {
          initial = initial.slice(-MAX_OUTPUT_CHARS);
        }
        outputBySession.set(payload.sessionId, initial);
      }
      const nextSessionId = resolveSessionSelection(payload?.sessionId || payload?.snapshot?.sessionId);
      if (nextSessionId) {
        setActiveSession(nextSessionId, true);
      } else {
        activeSessionId = '';
        setSessionMeta(undefined);
        setRenderedOutput('');
        renderSessions();
      }
      break;
    }

    case 'terminal/output':
      if (payload?.sessionId) {
        appendOutput(payload.chunk || '', payload.sessionId);
      }
      break;

    case 'terminal/snapshot':
      if (payload?.sessionId) {
        const index = sessionsCache.findIndex(session => session.sessionId === payload.sessionId);
        if (index >= 0) {
          sessionsCache[index] = { ...sessionsCache[index], ...payload };
        } else {
          sessionsCache.unshift(payload);
        }
        if (payload.lastOutputPreview && !outputBySession.has(payload.sessionId)) {
          outputBySession.set(payload.sessionId, payload.lastOutputPreview);
        }
        if (!activeSessionId || payload.sessionId === activeSessionId) {
          setSessionMeta(payload);
        }
        renderSessions();
      }
      break;

    case 'terminal/list': {
      sessionsCache = Array.isArray(payload?.sessions) ? payload.sessions : [];
      for (const session of sessionsCache) {
        if (session?.sessionId && session.lastOutputPreview && !outputBySession.has(session.sessionId)) {
          outputBySession.set(session.sessionId, session.lastOutputPreview);
        }
      }
      const nextSessionId = resolveSessionSelection();
      if (nextSessionId) {
        setActiveSession(nextSessionId, true);
      } else {
        activeSessionId = '';
        preferredSessionId = '';
        setSessionMeta(undefined);
        setRenderedOutput('');
        renderSessions();
      }
      break;
    }

    case 'terminal/started':
    case 'terminal/restarted':
      if (payload?.sessionId) {
        setActiveSession(payload.sessionId, false);
        if (payload?.output) {
          let out = payload.output;
          if (out.length > MAX_OUTPUT_CHARS) {
            out = out.slice(-MAX_OUTPUT_CHARS);
          }
          outputBySession.set(payload.sessionId, out);
        }
        renderActiveOutput();
        if (payload?.snapshot) {
          setSessionMeta(payload.snapshot);
        }
        scheduleRefreshSessions(payload.sessionId, 0);
        scheduleRefreshSessions(payload.sessionId, 150);
        scheduleRefreshSessions(payload.sessionId, 500);
      }
      break;

    case 'terminal/stopped':
      if (payload?.sessionId) {
        if (payload?.output) appendOutput(payload.output, payload.sessionId);
        if (payload?.snapshot) {
          const index = sessionsCache.findIndex(session => session.sessionId === payload.sessionId);
          if (index >= 0) {
            sessionsCache[index] = { ...sessionsCache[index], ...payload.snapshot };
          }
          setSessionMeta(payload.snapshot);
          renderSessions();
        }
        scheduleRefreshSessions(payload.sessionId, 0);
        scheduleRefreshSessions(payload.sessionId, 150);
        scheduleRefreshSessions(payload.sessionId, 500);
      }
      break;
  }
});

post('ui/terminal/ready');
refreshSessions();
